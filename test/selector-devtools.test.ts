/// <reference lib="dom" />
import { it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { chromium, expect, type Browser, type BrowserType, type Page } from '@playwright/test';
import { SelectorBrowser } from '../src/selectors/browser';
import { devToolsFrontendUrl } from '../src/selectors/devtools';
import { launchDevToolsBrowser, SELECTOR_DEBUGGING_ARGS } from '../src/selectors/startup';
import { selectorErrorReply } from '../src/selectors/errors';

it('the DevTools window prefers Chrome and falls back only for a missing executable', async () => {
  const channels: Array<string | undefined> = [];
  const browser = {} as Browser;
  const launcher = {
    launch: async (options: Parameters<BrowserType['launch']>[0]) => {
      channels.push(options?.channel);
      assert.equal(options?.headless, false);
      assert.equal(options?.args, undefined, 'The frontend does not expose a debugging server.');
      if (options?.channel === 'chrome')
        throw new Error("Chromium distribution 'chrome' is not found");
      return browser;
    },
  } as BrowserType;
  assert.equal(await launchDevToolsBrowser(launcher), browser);
  assert.deepEqual(channels, ['chrome', undefined]);
});

it('a blocked DevTools launch stops with authored guidance and no local diagnostics', async () => {
  let attempts = 0;
  const launcher = {
    launch: async () => {
      attempts++;
      throw new Error('EPERM secret-profile-path');
    },
  } as unknown as BrowserType;
  await assert.rejects(launchDevToolsBrowser(launcher), (error: unknown) => {
    const reply = selectorErrorReply(error);
    assert.match(reply.error!, /Your website remains open/);
    assert.doesNotMatch(JSON.stringify(reply), /EPERM|secret-profile/);
    return true;
  });
  assert.equal(attempts, 1);
});

it('DevTools accepts only bounded local endpoint components', () => {
  const target = '0123456789ABCDEF0123456789ABCDEF';
  assert.equal(
    devToolsFrontendUrl(12345, target),
    `devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:12345/devtools/page/${target}`,
  );
  for (const port of [0, -1, 65536, 0.5, NaN, Infinity])
    assert.throws(() => devToolsFrontendUrl(port, target));
  for (const invalid of ['', 'x'.repeat(33), `${target}?host=example.com`, '../page'])
    assert.throws(() => devToolsFrontendUrl(12345, invalid));
  assert.ok(SELECTOR_DEBUGGING_ARGS.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(SELECTOR_DEBUGGING_ARGS.includes('--remote-debugging-port=0'));
  assert.ok(SELECTOR_DEBUGGING_ARGS.includes('--remote-allow-origins=devtools://devtools'));
  assert.ok(SELECTOR_DEBUGGING_ARGS.every((argument) => !argument.includes('*')));
});

it(
  'full Chrome DevTools attaches to the existing page, follows popups, reopens and cleans up',
  { timeout: 60000 },
  async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<!doctype html><h1>Selector DevTools ${req.url === '/popup' ? 'popup' : 'original'}</h1><label>State<input id="state"></label>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const session = new SelectorBrowser(
      chromium,
      process.env.STUDIO_BROWSER_CHANNEL,
      process.env.STUDIO_DEVTOOLS_HEADED !== '1',
    );
    try {
      await session.perform({ type: 'navigate', url });
      const original = (session as any).page as Page;
      await original.locator('#state').fill('keep existing form data');
      await original.evaluate(() => {
        document.cookie = 'studio-session=retained';
        sessionStorage.setItem('studio-session', 'retained');
      });
      const opened = await session.perform({ type: 'devtools' });
      assert.equal(opened.devtoolsOpen, true);
      const frontend = (session as any).devtools.frontend as Page;
      await expect(
        frontend.getByText('Selector DevTools original', { exact: false }),
      ).toBeVisible();
      for (const name of [
        'Elements',
        'Console',
        'Sources',
        'Network',
        'Performance',
        'Memory',
        'Application',
      ])
        await expect(frontend.getByRole('tab', { name, exact: true })).toBeVisible();
      await expect(original.locator('#state')).toHaveValue('keep existing form data');
      assert.equal(
        await original.evaluate(() => sessionStorage.getItem('studio-session')),
        'retained',
      );
      assert.equal(await original.evaluate(() => document.cookie), 'studio-session=retained');
      assert.equal(
        (session as any).page,
        original,
        'Opening DevTools must not recreate the website.',
      );

      await frontend.getByRole('tab', { name: 'Console', exact: true }).click();
      const consolePrompt = frontend.getByRole('textbox', { name: 'Console prompt' });
      await consolePrompt.fill('document.querySelector("h1").dataset.devtools = "connected"');
      await consolePrompt.press('Enter');
      await expect(original.locator('h1')).toHaveAttribute('data-devtools', 'connected');
      await frontend.getByRole('tab', { name: 'Elements', exact: true }).click();

      // A normal webpage origin must not gain a debugging connection.
      const websocket = new URL(`ws://${new URL(frontend.url()).searchParams.get('ws')}`);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const probe = request(
          {
            hostname: websocket.hostname,
            port: websocket.port,
            path: websocket.pathname,
            headers: {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Version': '13',
              'Sec-WebSocket-Key': 'c3R1ZGlvLXRlc3QtMTIzNA==',
              Origin: 'https://untrusted.example',
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        probe.on('upgrade', (_response, socket) => {
          socket.destroy();
          reject(new Error('An ordinary webpage origin was accepted.'));
        });
        probe.on('error', reject);
        probe.setTimeout(5000, () =>
          probe.destroy(new Error('Debugging security probe timed out.')),
        );
        probe.end();
      });
      assert.equal(status, 403);

      await session.perform({ type: 'devtools' });
      assert.equal(
        (session as any).devtools.frontend,
        frontend,
        'Reuse the existing DevTools window.',
      );
      const popupPromise = original.context().waitForEvent('page');
      await original.evaluate((popupUrl) => window.open(popupUrl), `${url}/popup`);
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await session.perform({ type: 'refresh' });
      assert.equal((session as any).page, popup);
      assert.equal((session as any).devtools.frontend, frontend);
      await expect(frontend.getByText('Selector DevTools popup', { exact: false })).toBeVisible();

      await popup.close();
      await session.perform({ type: 'refresh' });
      assert.equal((session as any).page, original);
      await expect(
        frontend.getByText('Selector DevTools original', { exact: false }),
      ).toBeVisible();
      await expect(original.locator('#state')).toHaveValue('keep existing form data');
      await frontend.screenshot({ path: '.test-dist/selector-chrome-devtools.png' });
      await frontend.close();
      assert.equal((await session.perform({ type: 'refresh' })).devtoolsOpen, false);
      assert.equal((await session.perform({ type: 'devtools' })).devtoolsOpen, true);
      const reopened = (session as any).devtools.frontend as Page;
      assert.notEqual(reopened, frontend);
      await expect(
        reopened.getByText('Selector DevTools original', { exact: false }),
      ).toBeVisible();
      const devtoolsBrowser = reopened.context().browser()!;
      const websiteBrowser = original.context().browser()!;
      await session.close();
      assert.equal(devtoolsBrowser.isConnected(), false);
      assert.equal(websiteBrowser.isConnected(), false);
    } finally {
      await session.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
