/// <reference lib="dom" />
import { it, after, before } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { chromium, firefox, webkit, Browser, Page, expect } from '@playwright/test';
import { inspectPoint } from '../src/selectors/inspect';
import { SelectorBrowser } from '../src/selectors/browser';
import { BrowserReply } from '../src/selectors/protocol';
import { selectorHtml } from '../src/selectors/view';

let browser: Browser, page: Page, url: string;
const html = `<!doctype html><html><body>
<button id="checkout" data-testid="checkout">Checkout</button>
<button>Repeat</button><button data-testid="second-repeat">Repeat</button>
<label for="email">Email address</label><input id="email" placeholder="name@example.com">
<img alt="Company logo" width="30" height="30">
<div id="shadow"></div><iframe title="Payments" src="/frame" width="400" height="150"></iframe>
<script>const root=document.getElementById('shadow').attachShadow({mode:'open'});root.innerHTML='<button data-testid="shadow-save">Save in shadow</button>';</script>
</body></html>`;
const formHtml = `<!doctype html><html><head><style>
body{font:16px system-ui;margin:24px;color:#222;background:#fff}form{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:1100px}label{display:grid;gap:5px}input,textarea,select,[contenteditable]{font:inherit;padding:6px;border:1px solid #888;border-radius:4px}input[type=checkbox]{width:20px;height:20px}#scrollPanel{height:90px;overflow:auto;border:1px solid #888;margin-top:12px}#scrollPanel div{height:500px;padding:10px}iframe{display:block;width:500px;height:100px;margin-top:12px}#menu{position:absolute;left:650px;top:28px;padding:6px}#menu button{display:none}#menu:hover button{display:inline-block}#slider{position:absolute;left:820px;top:670px;width:250px}#formShadow{position:absolute;left:650px;top:740px}
</style></head><body><h1>Browse input checks</h1><form id="form">
<label>Email<input id="email" type="email"></label><label>Password<input id="password" type="password"></label>
<label>Letters only<input id="masked"></label><label>Existing value<input id="existing" value="replace"></label>
<label>Notes<textarea id="notes" rows="2"></textarea></label><label>Rich text<div id="rich" contenteditable="true" role="textbox"></div></label>
<label>Controlled field<input id="controlled"></label><label>Plan<select id="plan"><option value="">Choose</option><option value="one">One</option><option value="two">Two</option></select></label>
<label>Remember<input id="remember" type="checkbox"></label><button id="submit">Save</button>
</form><output id="submitted"></output><div id="scrollPanel"><div>Scrollable form section</div></div>
<iframe title="Embedded form" src="/form-frame"></iframe>
<div id="menu">Hover menu <button id="menuAction">Menu action</button></div><input id="slider" type="range" min="0" max="100" value="0"><div id="formShadow"></div>
<script>
document.querySelector('#formShadow').attachShadow({mode:'open'}).innerHTML='<input id="shadowField" aria-label="Shadow input">';
document.querySelector('#menuAction').addEventListener('click',()=>document.querySelector('#submitted').textContent='Menu selected');
document.querySelector('#masked').addEventListener('keydown',event=>{if(/^[0-9]$/.test(event.key))event.preventDefault()});
document.querySelector('#controlled').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase()});
document.querySelector('#form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#submitted').textContent='Saved'});
</script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader(
    'X-Frame-Options',
    ['/frame', '/form-frame'].includes(request.url || '') ? 'SAMEORIGIN' : 'DENY',
  );
  response.end(
    request.url === '/frame'
      ? '<button aria-label="Pay securely">Pay</button>'
      : request.url === '/forms'
        ? formHtml
        : request.url === '/form-frame'
          ? '<label>Embedded value<input id="frameField"></label>'
          : html,
  );
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const name = process.env.STUDIO_BROWSER || 'chromium';
  const engine = { chromium, firefox, webkit }[name];
  if (!engine) throw new Error('Unknown test browser.');
  browser = await engine.launch({
    ...(name === 'chromium' && process.env.STUDIO_BROWSER_CHANNEL
      ? { channel: process.env.STUDIO_BROWSER_CHANNEL }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
});
after(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function inspect(selector: string) {
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds);
  return inspectPoint(page, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
it('ranks a unique accessible role first and includes verified test ID, CSS and XPath alternatives', async () => {
  const result = await inspect('#checkout');
  assert.match(
    result.candidates[0].code,
    /getByRole\("button", \{ name: "Checkout", exact: true \}\)/,
  );
  assert.equal(result.candidates[0].unique, true);
  for (const kind of ['Playwright test ID', 'CSS ID', 'CSS path', 'XPath'])
    assert.ok(
      result.candidates.some((c) => c.kind === kind),
      kind,
    );
  assert.ok(result.candidates.every((c) => c.matches > 0));
});
it('prefers a unique test ID when the accessible name is ambiguous', async () => {
  const result = await inspect('[data-testid="second-repeat"]');
  assert.equal(result.candidates[0].kind, 'Playwright test ID');
  const role = result.candidates.find((c) => c.kind === 'Playwright role');
  assert.equal(role?.matches, 2);
  assert.equal(role?.unique, false);
});
it('offers form labels, placeholders and image alt text', async () => {
  const field = await inspect('#email');
  assert.ok(field.candidates.some((c) => c.kind === 'Playwright label'));
  assert.ok(field.candidates.some((c) => c.kind === 'Playwright placeholder'));
  const image = await inspect('img');
  assert.ok(image.candidates.some((c) => c.kind === 'Playwright alt text'));
});
it('inspects shadow DOM and scopes iframe locators to the correct frame', async () => {
  const shadow = await inspect('[data-testid="shadow-save"]');
  assert.ok(shadow.candidates.some((c) => c.code.includes('shadow-save')));
  assert.ok(!shadow.candidates.some((c) => c.kind === 'XPath'));
  assert.match(shadow.note!, /shadow root/);
  const target = page.frameLocator('iframe').getByRole('button');
  const bounds = await target.boundingBox();
  assert.ok(bounds);
  const framed = await inspectPoint(page, bounds.x + 3, bounds.y + 3);
  assert.match(framed.candidates[0].code, /^page\.frameLocator\(.+\)\.getByRole\(/);
  assert.equal(framed.candidates[0].unique, true);
});
it('browser session navigates, types, refreshes and inspects pages that forbid iframe embedding', async () => {
  const session = new SelectorBrowser(chromium, process.env.STUDIO_BROWSER_CHANNEL);
  try {
    const opened = await session.perform({ type: 'navigate', url });
    assert.ok(opened.screenshot);
    assert.equal(opened.url, url + '/');
    const bounds = await page.locator('#email').boundingBox();
    assert.ok(bounds);
    await session.perform({ type: 'click', x: bounds.x + 3, y: bounds.y + 3 });
    await session.perform({ type: 'type', text: 'person@example.com' });
    const result = await session.perform({ type: 'inspect', x: bounds.x + 3, y: bounds.y + 3 });
    assert.equal(result.inspection?.tag, 'input');
    assert.ok(
      !JSON.stringify(result.inspection).includes('person@example.com'),
      'Input values are not selector suggestions.',
    );
  } finally {
    await session.close();
  }
});
it('packaged worker opens the website with automatic browser selection, including an empty browser cache', async () => {
  const root = path.resolve(__dirname, '..');
  const emptyCache = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-empty-browser-cache-'));
  const worker = fork(path.join(root, 'dist/selectorWorker.js'), [], {
    cwd: root,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      PLAYWRIGHT_STUDIO_SELECTOR_ROOT: root,
      PLAYWRIGHT_STUDIO_SELECTOR_CHANNEL: '',
      ...(process.env.STUDIO_BROWSER_CHANNEL ? { PLAYWRIGHT_BROWSERS_PATH: emptyCache } : {}),
    },
  });
  try {
    const response = await new Promise<BrowserReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timed out')), 20000);
      worker.once('message', (value) => {
        clearTimeout(timer);
        resolve(value as BrowserReply);
      });
      worker.once('error', reject);
      worker.send({ id: 1, action: { type: 'navigate', url } });
    });
    assert.equal(response.error, undefined);
    assert.ok(response.screenshot);
    if (process.env.STUDIO_BROWSER_CHANNEL)
      assert.ok(
        ['Google Chrome', 'Microsoft Edge'].includes(response.browserName!),
        'Must fall back when the Playwright browser cache is empty.',
      );
  } finally {
    worker.disconnect();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        worker.kill('SIGKILL');
        resolve();
      }, 5000);
      worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fs.rmSync(emptyCache, { recursive: true, force: true });
  }
});

it('selector webview browses, inspects, copies and clears stale suggestions without script errors', async () => {
  const session = new SelectorBrowser(chromium, process.env.STUDIO_BROWSER_CHANNEL);
  const view = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors: string[] = [];
  const copied: unknown[] = [];
  view.on('pageerror', (error) => errors.push(error.message));
  await view.exposeFunction('sendToHost', async (action: any) => {
    if (action.type === 'ready' || action.type === 'viewState') return;
    if (action.type === 'copy') {
      copied.push(action);
      await view.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
        ...action,
        type: 'copied',
      });
      return;
    }
    const result = await session.perform(action);
    await view.evaluate(
      (data) => window.dispatchEvent(new MessageEvent('message', { data })),
      result,
    );
  });
  await view.addInitScript(() => {
    (window as any).acquireVsCodeApi = () => ({
      postMessage: (action: unknown) => (window as any).sendToHost(action),
    });
  });
  try {
    await view.goto('about:blank');
    await view.setContent(selectorHtml());
    await view.evaluate(() => {
      for (const [key, value] of Object.entries({
        'font-family': 'system-ui',
        foreground: '#e5e7eb',
        'editor-background': '#111827',
        'input-background': '#1b2535',
        'input-foreground': '#e5e7eb',
        'panel-border': '#354258',
        'button-background': '#2764df',
        'button-foreground': 'white',
        focusBorder: '#72a5ff',
      }))
        document.documentElement.style.setProperty('--vscode-' + key, value);
    });
    await view.getByLabel('Website', { exact: true }).fill(url);
    await view.getByRole('button', { name: 'Open website' }).click();
    await view.locator('#website').waitFor({ state: 'visible' });
    const preview = view.locator('#website');
    const previewBounds = (await preview.boundingBox())!;
    const target = (await page.locator('#checkout').boundingBox())!;
    await preview.click({
      position: {
        x: ((target.x + target.width / 2) * previewBounds.width) / 1280,
        y: ((target.y + target.height / 2) * previewBounds.height) / 800,
      },
    });
    await view.getByText('Recommended · Playwright role', { exact: true }).waitFor();
    await view.getByRole('button', { name: 'Copy Playwright', exact: true }).first().click();
    await view.waitForFunction(() =>
      document.getElementById('candidates')!.textContent!.includes('Unique match'),
    );
    assert.deepEqual(copied[0], { type: 'copy', index: 0, format: 'playwright' });
    await view.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    await view.screenshot({
      path: path.resolve(__dirname, 'selector-intelligence.png'),
      fullPage: true,
    });
    await view.getByRole('button', { name: 'Reload', exact: true }).click();
    await view
      .getByText('Inspect an element to see its current selectors.', { exact: true })
      .waitFor();
    assert.equal(
      await view.getByRole('button', { name: 'Copy Playwright', exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
  } finally {
    await view.close();
    await session.close();
  }
});

it('selector webview queues interaction during browser work and clears queued actions after errors', async () => {
  const view = await browser.newPage();
  try {
    await view.addInitScript(() => {
      (window as any).messages = [];
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (action: any) => {
          if (!['ready', 'viewState'].includes(action.type)) (window as any).messages.push(action);
        },
      });
    });
    await view.goto('about:blank');
    await view.setContent(selectorHtml());
    const screenshot = (await page.screenshot({ type: 'jpeg' })).toString('base64');
    await view.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
      id: 0,
      screenshot,
    });
    await view.getByLabel('Website', { exact: true }).fill(url);
    await view.getByRole('button', { name: 'Open website' }).click();
    await view.getByRole('button', { name: 'Reload', exact: true }).click();
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await view.evaluate(() => (window as any).messages.length), 1);
    await view.evaluate(() =>
      window.dispatchEvent(new MessageEvent('message', { data: { id: 1 } })),
    );
    assert.equal(await view.evaluate(() => (window as any).messages.at(-1).type), 'reload');
    await view.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { id: 2, error: 'Browser unavailable' } }),
      ),
    );
    assert.equal(await view.locator('#status').textContent(), 'Browser unavailable');
    assert.equal(await view.evaluate(() => (window as any).messages.length), 2);
    await view.getByRole('button', { name: 'Open website' }).click();
    assert.equal(await view.evaluate(() => (window as any).messages.at(-1).type), 'navigate');
  } finally {
    await view.close();
  }
});

it('missing browser has compact recovery controls, setup feedback and no horizontal overflow', async () => {
  const view = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors: string[] = [];
  view.on('pageerror', (error) => errors.push(error.message));
  try {
    await view.addInitScript(() => {
      (window as any).messages = [];
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (action: any) => {
          if (!['ready', 'viewState'].includes(action.type)) (window as any).messages.push(action);
        },
      });
    });
    await view.goto('about:blank');
    await view.setContent(selectorHtml());
    assert.equal(await view.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
    assert.equal(await view.locator('#typing').isVisible(), false);
    await view.screenshot({ path: path.resolve(__dirname, 'selector-empty.png'), fullPage: true });
    const missing = {
      id: 1,
      error:
        'Playwright Chromium, Google Chrome and Microsoft Edge were not found. Install Chromium to open websites here.',
      errorCode: 'browser-missing',
      errorTitle: 'A browser is needed',
      retryable: true,
    };
    await view.evaluate(
      (data) => window.dispatchEvent(new MessageEvent('message', { data })),
      missing,
    );
    for (const name of ['Install Chromium', 'Use Chrome', 'Use Edge'])
      assert.equal(await view.getByRole('button', { name, exact: true }).isVisible(), true);
    assert.equal(await view.locator('#typing').isVisible(), false);
    await view.getByRole('button', { name: 'Install Chromium', exact: true }).click();
    assert.deepEqual(await view.evaluate(() => (window as any).messages.at(-1)), {
      type: 'setup',
      action: 'installChromium',
    });
    await view.evaluate(() =>
      window.dispatchEvent(new MessageEvent('message', { data: { id: 0, setupBusy: true } })),
    );
    assert.equal(await view.getByLabel('Website', { exact: true }).isDisabled(), true);
    await view.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
      ...missing,
      setupBusy: false,
    });
    assert.equal(await view.getByLabel('Website', { exact: true }).isDisabled(), false);
    await view.screenshot({
      path: path.resolve(__dirname, 'selector-recovery.png'),
      fullPage: true,
    });
    for (const width of [900, 600, 420]) {
      await view.setViewportSize({ width, height: 850 });
      assert.equal(
        await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `Overflow at ${width}px`,
      );
    }
    await view.screenshot({ path: path.resolve(__dirname, 'selector-narrow.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await view.close();
  }
});

async function openBrowseForm(delayFirstClick = false) {
  const session = new SelectorBrowser(chromium, process.env.STUDIO_BROWSER_CHANNEL);
  const view = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
  const pageErrors: string[] = [];
  const actions: any[] = [];
  const copied: string[] = [];
  view.on('pageerror', (error) => pageErrors.push(error.message));
  let delayed = false;
  await view.exposeFunction('sendToHost', async (action: any) => {
    if (action.type === 'ready' || action.type === 'viewState') return;
    actions.push(action);
    if (delayFirstClick && action.type === 'click' && !delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const result = await session.perform(action);
    if (result.clipboardText !== undefined) {
      copied.push(result.clipboardText);
      delete result.clipboardText;
    }
    await view.evaluate(
      (data) => window.dispatchEvent(new MessageEvent('message', { data })),
      result,
    );
  });
  await view.addInitScript(() => {
    (window as any).acquireVsCodeApi = () => ({
      postMessage: (action: unknown) => (window as any).sendToHost(action),
    });
  });
  await view.goto('about:blank');
  await view.setContent(selectorHtml());
  await view.getByLabel('Website', { exact: true }).fill(url + '/forms');
  await view.getByRole('button', { name: 'Open website', exact: true }).click();
  await view.locator('#website').waitFor({ state: 'visible' });
  await view.getByRole('button', { name: 'Browse', exact: true }).click();
  const remote = (session as unknown as { page: Page }).page;
  const preview = view.locator('#website');
  const position = async (target: ReturnType<Page['locator']>) => {
    const bounds = (await target.boundingBox())!;
    const previewBounds = (await preview.boundingBox())!;
    assert.ok(bounds && previewBounds);
    return {
      x: ((bounds.x + Math.min(12, bounds.width / 2)) * previewBounds.width) / 1280,
      y: ((bounds.y + bounds.height / 2) * previewBounds.height) / 800,
    };
  };
  const click = async (selector: string) =>
    preview.click({ position: await position(remote.locator(selector)) });
  const idle = () =>
    expect(view.locator('#previewArea')).toHaveAttribute('aria-busy', 'false', { timeout: 10000 });
  const close = async () => {
    await view.close();
    await session.close();
    assert.deepEqual(pageErrors, []);
  };
  return { view, remote, preview, click, position, idle, close, actions, copied };
}

it('reopened webview restores Browse mode, draft URL and selectors, then clears refresh busy state', async () => {
  const view = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  try {
    await view.addInitScript(() => {
      (window as any).messages = [];
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => (window as any).messages.push(message),
      });
    });
    await view.goto('about:blank');
    await view.setContent(selectorHtml());
    assert.deepEqual(await view.evaluate(() => (window as any).messages[0]), { type: 'ready' });
    const screenshot = (await page.screenshot({ type: 'jpeg' })).toString('base64');
    const inspection = await inspect('#checkout');
    await view.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
      id: 0,
      screenshot,
      url,
      inspection,
      uiState: { mode: 'browse', address: 'https://example.com/draft', selectorScroll: 0 },
      sessionBusy: true,
      sessionAction: 'refresh',
    });
    await expect(view.getByRole('button', { name: 'Browse', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(view.getByLabel('Website', { exact: true })).toHaveValue(
      'https://example.com/draft',
    );
    await expect(view.getByText('Recommended · Playwright role', { exact: true })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Open Chrome DevTools' })).toBeEnabled();
    await view.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
      id: 1,
      screenshot,
      url,
    });
    await expect(view.locator('#status')).not.toContainText('Finishing');
    await view.getByRole('button', { name: 'Inspect', exact: true }).click();
    assert.equal(
      await view.evaluate(
        () =>
          (window as any).messages.filter((message: any) => message.type === 'viewState').at(-1)
            .state.mode,
      ),
      'inspect',
    );
    await view.evaluate(() =>
      window.dispatchEvent(new MessageEvent('message', { data: { id: 0, sessionClosed: true } })),
    );
    await expect(view.locator('#website')).not.toBeVisible();
    await expect(view.getByRole('button', { name: 'Open Chrome DevTools' })).toBeDisabled();
  } finally {
    await view.close();
  }
});

it('Browse supports direct field typing, selection, deletion, Tab and Enter without the helper field', async () => {
  const form = await openBrowseForm();
  try {
    await form.click('#email');
    await form.view.keyboard.type('person@example.com');
    await expect(form.remote.locator('#email')).toHaveValue('person@example.com');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.keyboard.type('new@example.com');
    await form.view.keyboard.press('Backspace');
    await form.view.keyboard.type('m');
    await expect(form.remote.locator('#email')).toHaveValue('new@example.com');
    await form.view.keyboard.press('Tab');
    await form.view.keyboard.type('test-password');
    await expect(form.remote.locator('#password')).toHaveValue('test-password');
    await form.view.keyboard.press('Shift+Tab');
    await form.view.keyboard.press('End');
    await form.view.keyboard.press('Shift+ArrowLeft');
    await form.view.keyboard.type('X');
    await expect(form.remote.locator('#email')).toHaveValue('new@example.coX');
    await form.click('#submit');
    await form.view.keyboard.press('Enter');
    await expect(form.remote.locator('#submitted')).toHaveText('Saved');
    await form.idle();
    assert.equal(await form.view.locator('#input').inputValue(), '');
  } finally {
    await form.close();
  }
});

it('Browse preserves rapid typing during a delayed click and respects input keydown handlers', async () => {
  const form = await openBrowseForm(true);
  try {
    const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(5);
    await form.click('#email');
    await form.view.keyboard.type(text);
    await expect(form.remote.locator('#email')).toHaveValue(text, { timeout: 10000 });
    await form.click('#masked');
    await form.view.keyboard.type('a1b2c3');
    await expect(form.remote.locator('#masked')).toHaveValue('abc');
    await form.click('#controlled');
    await form.view.keyboard.type('controlled');
    await expect(form.remote.locator('#controlled')).toHaveValue('CONTROLLED');
  } finally {
    await form.close();
  }
});

it('Browse edits multiline, rich text and iframe fields, and isolates URL and Inspect typing', async () => {
  const form = await openBrowseForm();
  try {
    await form.click('#notes');
    await form.view.keyboard.type('First line');
    await form.view.keyboard.press('Enter');
    await form.view.keyboard.type('Second line');
    await expect(form.remote.locator('#notes')).toHaveValue('First line\nSecond line');
    await form.click('#rich');
    await form.view.keyboard.type('Editable content');
    await expect(form.remote.locator('#rich')).toHaveText('Editable content');
    const framed = form.remote.frameLocator('iframe').locator('#frameField');
    await form.preview.click({ position: await form.position(framed) });
    await form.view.keyboard.type('Inside frame');
    await expect(framed).toHaveValue('Inside frame');
    await form.view.getByLabel('Website', { exact: true }).fill('https://example.com');
    await form.view.getByRole('button', { name: 'Inspect', exact: true }).click();
    await form.click('#email');
    await form.view.keyboard.type('Must not enter the website');
    await form.idle();
    await expect(form.remote.locator('#email')).toHaveValue('');
    await expect(framed).toHaveValue('Inside frame');
  } finally {
    await form.close();
  }
});

it('Browse supports double-click selection, checkboxes, native selects and scrolling under the pointer', async () => {
  const form = await openBrowseForm();
  try {
    await form.preview.dblclick({
      position: await form.position(form.remote.locator('#existing')),
    });
    await form.view.keyboard.type('changed');
    await expect(form.remote.locator('#existing')).toHaveValue('changed');
    await form.click('#remember');
    await expect(form.remote.locator('#remember')).toBeChecked();
    await form.view.keyboard.press('Space');
    await expect(form.remote.locator('#remember')).not.toBeChecked();
    await form.click('#plan');
    await form.view.keyboard.press('ArrowDown');
    await form.view.keyboard.press('ArrowDown');
    await form.view.keyboard.press('Enter');
    await expect(form.remote.locator('#plan')).toHaveValue('two');
    await form.preview.hover({
      position: await form.position(form.remote.locator('#scrollPanel')),
    });
    await form.view.mouse.wheel(0, 350);
    await expect
      .poll(() => form.remote.locator('#scrollPanel').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  } finally {
    await form.close();
  }
});

it('Browse pastes text and commits international input once, without retaining it in the webview', async () => {
  const form = await openBrowseForm();
  try {
    await form.click('#notes');
    await form.view.locator('#websiteInput').evaluate((receiver: HTMLTextAreaElement) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Pasted text\nSecond line 🔎');
      receiver.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await expect(form.remote.locator('#notes')).toHaveValue('Pasted text\nSecond line 🔎');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.locator('#websiteInput').evaluate((receiver: HTMLTextAreaElement) => {
      const text = 'こんにちは';
      receiver.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      receiver.value = text;
      receiver.dispatchEvent(
        new InputEvent('input', {
          data: text,
          inputType: 'insertCompositionText',
          isComposing: true,
          bubbles: true,
        }),
      );
      receiver.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
      receiver.value = text;
      receiver.dispatchEvent(
        new InputEvent('input', { data: text, inputType: 'insertFromComposition', bubbles: true }),
      );
    });
    await expect(form.remote.locator('#notes')).toHaveValue('こんにちは');
    await form.idle();
    assert.equal(await form.view.locator('#websiteInput').inputValue(), '');
    assert.equal(
      form.actions.filter((action) => action.type === 'type' && action.text === 'こんにちは')
        .length,
      1,
    );
    await form.view.keyboard.press('Shift+Enter');
    await form.view.keyboard.type('Next');
    await expect(form.remote.locator('#notes')).toHaveValue('こんにちは\nNext');
    await form.view.keyboard.press('Escape');
    await expect(form.view.getByRole('button', { name: 'Browse', exact: true })).toBeFocused();
    await form.view.keyboard.type('toolbar only');
    await form.idle();
    await expect(form.remote.locator('#notes')).toHaveValue('こんにちは\nNext');
  } finally {
    await form.close();
  }
});

it('Browse opens hover menus, drags controls and types inside shadow DOM', async () => {
  const form = await openBrowseForm();
  try {
    await form.preview.hover({ position: await form.position(form.remote.locator('#menu')) });
    await expect(form.remote.locator('#menuAction')).toBeVisible();
    await form.click('#menuAction');
    await expect(form.remote.locator('#submitted')).toHaveText('Menu selected');
    const slider = (await form.remote.locator('#slider').boundingBox())!;
    const preview = (await form.preview.boundingBox())!;
    const left = preview.x + ((slider.x + 8) * preview.width) / 1280;
    const right = preview.x + ((slider.x + slider.width - 8) * preview.width) / 1280;
    const y = preview.y + ((slider.y + slider.height / 2) * preview.height) / 800;
    await form.view.mouse.move(left, y);
    await form.view.mouse.down();
    await form.view.mouse.move(right, y, { steps: 10 });
    await form.view.mouse.up();
    await expect
      .poll(async () => Number(await form.remote.locator('#slider').inputValue()))
      .toBeGreaterThan(90);
    await form.click('#shadowField');
    await form.view.keyboard.type('Shadow text');
    await expect(form.remote.locator('#shadowField')).toHaveValue('Shadow text');
    await form.idle();
  } finally {
    await form.close();
  }
});

it('Browse copies and cuts selected text, supports undo, and does not copy passwords', async () => {
  const form = await openBrowseForm();
  try {
    await form.click('#existing');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.keyboard.press('ControlOrMeta+C');
    await expect.poll(() => form.copied.at(-1)).toBe('replace');
    await expect(form.remote.locator('#existing')).toHaveValue('replace');
    await form.view.keyboard.press('ControlOrMeta+X');
    await expect(form.remote.locator('#existing')).toHaveValue('');
    await form.view.keyboard.press('ControlOrMeta+Z');
    await expect(form.remote.locator('#existing')).toHaveValue('replace');
    await form.click('#email');
    await form.view.keyboard.type('copy@example.com');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.keyboard.press('ControlOrMeta+C');
    await expect.poll(() => form.copied.at(-1)).toBe('copy@example.com');
    await form.click('#password');
    await form.view.keyboard.type('private-password');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.keyboard.press('ControlOrMeta+C');
    await form.idle();
    assert.equal(form.copied.at(-1), 'copy@example.com');
    await form.remote.locator('#existing').evaluate((element) =>
      element.addEventListener('copy', (event) => {
        (event as ClipboardEvent).clipboardData?.setData('text/plain', 'Website supplied text');
        event.preventDefault();
      }),
    );
    await form.click('#existing');
    await form.view.keyboard.press('ControlOrMeta+A');
    await form.view.keyboard.press('ControlOrMeta+C');
    await expect.poll(() => form.copied.at(-1)).toBe('Website supplied text');
    await form.idle();
  } finally {
    await form.close();
  }
});
