/// <reference lib="dom" />
import { it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { ExperimentWorkspace, scenarioFixture } from '../src/intelligence/execution';
import { instrumentScenario } from '../src/intelligence/analysis';
import { traceSummary } from '../src/intelligence/trace';
const repo = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-browser-test-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let logs = '';
const execute = (
  command: {
    executable: string;
    args: string[];
  },
  cwd: string,
  env: Record<string, string>,
): Promise<number | undefined> =>
  new Promise((resolve, reject) =>
    execFile(
      command.executable,
      command.args,
      // Allow the test timeout plus browser startup, server startup, and trace teardown.
      { cwd, env: { ...process.env, ...env }, timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        logs = stdout + stderr;
        if (!error) resolve(0);
        else if (typeof error.code === 'number') resolve(error.code);
        else reject(error);
      },
    ),
  );
it('real browser scenarios inject network faults, latency, clock, and offline state with readable trace evidence', async () => {
  const server = createServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    }),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const app = path.join(root, 'app');
  fs.mkdirSync(path.join(app, 'tests'), { recursive: true });
  fs.symlinkSync(
    path.join(repo, 'node_modules'),
    path.join(app, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(path.join(app, 'package.json'), '{"private":true}');
  fs.writeFileSync(
    path.join(app, 'server.cjs'),
    `require('http').createServer((req,res)=>{if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');}else{res.setHeader('Content-Type','text/html');res.end('<html><body><button>Pay</button></body></html>');}}).listen(${port},'127.0.0.1');`,
  );
  fs.writeFileSync(
    path.join(app, 'playwright.config.ts'),
    `export default {testDir:'./tests',timeout:30000,use:{baseURL:'http://127.0.0.1:${port}',browserName:${JSON.stringify(process.env.STUDIO_BROWSER || 'chromium')},channel:${JSON.stringify(process.env.STUDIO_BROWSER_CHANNEL)},trace:'on'},webServer:{command:'node server.cjs',url:'http://127.0.0.1:${port}',reuseExistingServer:true}};`,
  );
  const source = `import {test,expect} from '@playwright/test';test('checkout',async({page})=>{await page.goto('/');const status=await page.evaluate(async()=> (await fetch('/api/checkout')).status);expect(status).toBe(200);const scenario=JSON.parse(process.env.PLAYWRIGHT_STUDIO_SCENARIO || '{}');if(scenario.clock) expect(await page.evaluate(()=>Date.now())).toBeGreaterThanOrEqual(Date.parse(scenario.clock));});`;
  fs.writeFileSync(path.join(app, 'tests/checkout.spec.ts'), source);
  const workspace = await ExperimentWorkspace.create(
    app,
    path.join(root, 'storage'),
    { executable: process.execPath, args: [cli, 'test'] },
    execute,
  );
  const refs = [{ file: 'tests/checkout.spec.ts', title: 'checkout' }];
  try {
    await workspace.write('.studio-fixture.ts', scenarioFixture());
    await workspace.write(
      'tests/checkout.spec.ts',
      instrumentScenario({ file: 'tests/checkout.spec.ts', source }, '../.studio-fixture'),
    );
    const baseline = await workspace.run('baseline', refs);
    assert.equal(baseline.outcome, 'passed', logs);
    const fault = await workspace.run('HTTP error', refs, {
      PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify({
        name: 'HTTP failure',
        urlPattern: '**/api/**',
        status: 503,
      }),
    });
    assert.equal(fault.outcome, 'failed', logs);
    assert.ok(fault.report?.specs[0].traceFile);
    const trace = traceSummary(fault.report!.specs[0].traceFile!);
    assert.ok(
      trace.requests.some((r) => r.status === 503),
      JSON.stringify(trace),
    );
    const delayed = await workspace.run('latency and time', refs, {
      PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify({
        name: 'future',
        urlPattern: '**/api/**',
        latencyMs: 50,
        clock: '2030-01-01T00:00:00Z',
      }),
    });
    assert.equal(delayed.outcome, 'passed', logs);
    const attachment = delayed.report!.specs[0].attachments!.find(
      (a) => a.name === 'studio-scenario',
    )!;
    assert.equal(
      JSON.parse(Buffer.from(attachment.body!, 'base64').toString('utf8')).intercepted,
      1,
    );
    const offline = await workspace.run('offline', refs, {
      PLAYWRIGHT_STUDIO_SCENARIO: JSON.stringify({ name: 'offline', offline: true }),
    });
    assert.equal(offline.outcome, 'failed', logs);
    assert.match(offline.report!.specs[0].error!, /page.goto/);
    const offlineEvidence = offline.report!.specs[0].attachments!.find(
      (item) => item.name === 'studio-scenario',
    )!;
    assert.equal(
      JSON.parse(Buffer.from(offlineEvidence.body!, 'base64').toString('utf8')).offline,
      true,
    );
  } finally {
    await workspace.dispose();
  }
});
it('Intelligence webview renders accessibly, routes actions, and validates the scenario form', async () => {
  const engines = await import('@playwright/test');
  const { IntelligencePanel } = await import('../src/intelligence/panel');
  const { state } = await import('./vscodeMock');
  const panel = new IntelligencePanel(async () => {});
  panel.show(root);
  const browser = await engines[
    (process.env.STUDIO_BROWSER || 'chromium') as 'chromium' | 'firefox' | 'webkit'
  ].launch({ channel: process.env.STUDIO_BROWSER_CHANNEL });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    let page = await context.newPage();
    const errors: string[] = [];
    await context.addInitScript(() => {
      (window as any).messages = [];
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (message: unknown) => (window as any).messages.push(message),
      });
    });
    const render = async () => {
      // VS Code replaces the webview document when its HTML changes. A new page
      // avoids retaining WebKit's prior CSP nonce and document event handlers.
      await page.close();
      page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('about:blank');
      await page.setContent(state.panels.at(-1).webview.html);
      await page.evaluate(() => {
        const style = document.documentElement.style;
        for (const [key, value] of Object.entries({
          'font-family': 'system-ui',
          foreground: '#e5e7eb',
          'editor-background': '#111827',
          'sideBar-background': '#1b2535',
          descriptionForeground: '#9ca9be',
          'panel-border': '#354258',
          'button-background': '#2764df',
          'button-foreground': 'white',
          'input-background': '#111827',
          'input-foreground': '#e5e7eb',
          focusBorder: '#72a5ff',
        }))
          style.setProperty('--vscode-' + key, value);
      });
    };
    await render();
    assert.equal(await page.locator('.workflow-card').count(), 15);
    await page.getByRole('searchbox').fill('Scenario');
    assert.equal(await page.locator('.workflow-card:visible').count(), 1);
    await page.getByRole('searchbox').fill('');
    await page.screenshot({
      path: path.join(repo, '.test-dist/intelligence-dashboard.png'),
      fullPage: false,
    });
    await page.getByText('Advanced experiments', { exact: true }).click();
    await page.getByRole('button', { name: 'Edit shared configuration' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(repo, '.test-dist/intelligence-advanced.png'),
      fullPage: false,
    });
    await page.getByRole('button', { name: 'Scenario Lab' }).click();
    assert.equal(
      (await page.evaluate(() => (window as any).messages))[0].action,
      'openScenarioLab',
    );
    panel.show(root, {
      title: 'Scenario Lab',
      introduction: 'Reproduce faults with controlled browser conditions.',
      sections: [
        {
          title: 'Saved scenarios',
          columns: ['Name', 'Latency', 'HTTP'],
          rows: [['Shipping unavailable', 500, 503]],
        },
      ],
    });
    await render();
    await page.getByLabel('Name', { exact: true }).fill('Slow shipping');
    await page.getByLabel('Latency (ms)').fill('500');
    await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
    await page.waitForFunction(() => (window as any).messages.length === 1);
    const messages = await page.evaluate(() => (window as any).messages);
    assert.equal(messages[0].value.latencyMs, 500);
    assert.equal(messages[0].action, 'saveScenario');
    // Exercise all combinations of the four independent scenario controls.
    for (let mask = 0; mask < 16; mask++) {
      await page.evaluate(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'actionState', busy: false, message: 'Ready.' },
          }),
        ),
      );
      const latency = mask & 1 ? 500 : 0;
      const offline = Boolean(mask & 2);
      const status = mask & 4 ? 503 : undefined;
      const clock = mask & 8 ? '2030-01-01T00:00:00Z' : undefined;
      await page.getByLabel('Latency (ms)').fill(String(latency));
      await page.getByLabel('Offline', { exact: true }).setChecked(offline);
      await page.getByLabel('HTTP error').selectOption(status ? String(status) : '');
      await page.getByLabel('Browser time (ISO with timezone)').fill(clock || '');
      await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
      await page.waitForFunction((count) => (window as any).messages.length === count, mask + 2);
      const last = await page.evaluate(() => (window as any).messages.at(-1));
      assert.deepEqual(
        {
          latency: last.value.latencyMs,
          offline: last.value.offline,
          status: last.value.status,
          clock: last.value.clock,
        },
        { latency, offline, status, clock },
      );
      assert.equal(
        await page.getByRole('button', { name: 'Save scenario', exact: true }).isDisabled(),
        true,
      );
    }
    await page.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'actionState', busy: false, message: 'Ready.' },
        }),
      ),
    );
    await page.screenshot({
      path: path.join(repo, '.test-dist/intelligence-scenario.png'),
      fullPage: false,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    panel.dispose();
  }
});

it('analytics filters projects, preserves hostile titles as text, and renders empty history', async () => {
  const playwright = require(path.join(path.dirname(cli), 'index.js'));
  const browserName = process.env.STUDIO_BROWSER || 'chromium';
  const browser = await playwright[browserName].launch({
    headless: true,
    ...(browserName === 'chromium' && process.env.STUDIO_BROWSER_CHANNEL
      ? { channel: process.env.STUDIO_BROWSER_CHANNEL }
      : {}),
  });
  const { AnalyticsViewer } = await import('../src/analyticsViewer');
  const { state, EventEmitter } = await import('./vscodeMock');
  const updates = new EventEmitter<any>();
  const hostileTitle = '</script><script>window.injected=true</script>';
  const data: any = {
    history: [
      {
        workspaceRoot: 'workspace',
        capturedAt: new Date(),
        specs: [
          {
            file: 'a.spec.ts',
            line: 0,
            title: hostileTitle,
            projectName: 'chromium',
            status: 'failed',
            duration: 5,
          },
          {
            file: 'a.spec.ts',
            line: 1,
            title: 'passes',
            projectName: 'webkit',
            status: 'passed',
            duration: 1,
          },
        ],
      },
    ],
    onDidHistoryChange: updates.event,
  };
  const viewer = new AnalyticsViewer(data);
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    viewer.show();
    await page.setContent(state.panels.at(-1).webview.html);
    assert.equal(await page.locator('#unstable tr').count(), 2);
    assert.equal(
      await page.locator('#unstable tr').first().locator('td').first().textContent(),
      hostileTitle,
    );
    assert.equal(await page.evaluate(() => (window as any).injected), undefined);
    await page.locator('#project').selectOption('webkit');
    assert.equal(await page.locator('#unstable tr').count(), 1);
    assert.equal(await page.locator('#unstable tr td').first().textContent(), 'passes');
    data.history = [];
    updates.fire([]);
    await page.setContent(state.panels.at(-1).webview.html);
    assert.equal(await page.locator('#unstable tr').count(), 0);
    assert.equal(await page.locator('#trend .bar').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    viewer.dispose();
    await browser.close();
  }
});
