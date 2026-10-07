import { it, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBrowserAction, websiteUrl, VIEWPORT } from '../src/selectors/protocol';
import { SelectorIntelligence } from '../src/selectors/controller';
import { IntelligencePanel, features } from '../src/intelligence/panel';
import { IntelligenceController } from '../src/intelligence/controller';
import { stopAllRuns } from '../src/terminal';
import { reset, state, workspace, Uri } from './vscodeMock';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-selectors-')));
const context: any = {
  extensionUri: Uri.file(path.resolve(__dirname, '..')),
  storageUri: Uri.file(root),
  globalStorageUri: Uri.file(root),
  subscriptions: [],
};
const store: any = { history: [], getResultsFor: () => null };
beforeEach(() => {
  reset(root);
  workspace.isTrusted = true;
  workspace.textDocuments = [];
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

it('selector browser accepts websites and rejects executable/local URI schemes', () => {
  assert.equal(websiteUrl('https://example.com'), 'https://example.com/');
  assert.equal(websiteUrl('http://localhost:3000'), 'http://localhost:3000/');
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'command:workbench.action',
    'data:text/html,hello',
  ])
    assert.throws(() => websiteUrl(url));
});
it('browser protocol rejects arbitrary code, invalid coordinates and excessive input', () => {
  for (const value of [
    null,
    { type: 'evaluate', code: 'process.exit()' },
    { type: 'inspect', x: NaN, y: 1 },
    { type: 'click', x: VIEWPORT.width, y: 0 },
    { type: 'type', text: 'x'.repeat(10001) },
    { type: 'key', key: 'arbitrary' },
  ])
    assert.equal(parseBrowserAction(value), undefined);
  assert.deepEqual(parseBrowserAction({ type: 'scroll', delta: 1e10 }), {
    type: 'scroll',
    delta: 1600,
  });
});

it('browser protocol accepts bounded paste, selection keys and pointer details', () => {
  for (const key of [
    'Shift+ArrowLeft',
    'ControlOrMeta+A',
    'ControlOrMeta+Z',
    'Alt+Backspace',
    'Home',
    'End',
    'Shift+Enter',
    'ControlOrMeta+Enter',
  ])
    assert.deepEqual(parseBrowserAction({ type: 'key', key }), { type: 'key', key });
  assert.deepEqual(parseBrowserAction({ type: 'type', text: 'Hello\n世界', paste: true }), {
    type: 'type',
    text: 'Hello\n世界',
    paste: true,
  });
  assert.deepEqual(parseBrowserAction({ type: 'click', x: 10, y: 20, clickCount: 2 }), {
    type: 'click',
    x: 10,
    y: 20,
    clickCount: 2,
  });
  assert.deepEqual(parseBrowserAction({ type: 'scroll', x: 10, y: 20, delta: 200 }), {
    type: 'scroll',
    x: 10,
    y: 20,
    delta: 200,
  });
  for (const action of [
    { type: 'hover', x: 10, y: 20 },
    { type: 'drag', x: 10, y: 20, toX: 100, toY: 200 },
  ])
    assert.deepEqual(parseBrowserAction(action), action);
  for (const value of [
    { type: 'type', text: 'value', paste: 'yes' },
    { type: 'click', x: 0, y: 0, clickCount: 99 },
    { type: 'scroll', x: Infinity, y: 0, delta: 200 },
    { type: 'scroll', x: 2, delta: 200 },
    { type: 'key', key: 'ControlOrMeta+arbitrary' },
    { type: 'hover', x: -1, y: 20 },
    { type: 'drag', x: 10, y: 20, toX: Infinity, toY: 50 },
    { type: 'drag', x: 10, y: 20, toX: 1280, toY: 50 },
    { type: 'drag', x: 10, y: 20, toX: 100 },
  ])
    assert.equal(parseBrowserAction(value), undefined);
});
it('selector copy uses inspected candidates instead of accepting arbitrary webview text', async () => {
  const controller: any = new SelectorIntelligence(context);
  controller.show();
  await controller.handle({ type: 'ready' });
  controller.inspection = {
    candidates: [{ code: 'page.getByRole("button")', selector: 'button' }],
  };
  await controller.handle({ type: 'copy', index: 0, format: 'playwright', code: 'injected' });
  assert.equal(state.clipboard, 'page.getByRole("button")');
  assert.deepEqual(state.panels.at(-1).webview.posted.at(-1), {
    type: 'copied',
    index: 0,
    format: 'playwright',
  });
  await controller.handle({ type: 'copy', index: 999, format: 'selector' });
  assert.equal(state.clipboard, 'page.getByRole("button")');
  controller.dispose();
});

function installProjectDependencies(): void {
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules))
    fs.symlinkSync(
      path.resolve(__dirname, '../node_modules'),
      modules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
}

it('browser recovery installs Chromium with the pinned project CLI, not a custom test command', async () => {
  installProjectDependencies();
  const controller: any = new SelectorIntelligence(context);
  controller.show();
  await controller.handle({ type: 'ready' });
  state.settings.testCommand = 'do-not-run-user-tests';
  state.settings.workingDirectory = 'another-project';
  try {
    await controller.handle({ type: 'setup', action: 'installChromium' });
    assert.equal(state.tasks.length, 1);
    const invocation = state.tasks[0].execution;
    assert.equal(invocation.process, process.execPath);
    assert.match(invocation.args[0], /(?:playwright|@playwright[/\\]test)[/\\]cli\.js$/);
    assert.deepEqual(invocation.args.slice(1), ['install', 'chromium']);
    assert.equal(invocation.options.cwd, root);
    assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1');
    const messages = state.panels.at(-1).webview.posted;
    assert.ok(messages.some((message: any) => message.setupBusy === true));
    assert.ok(messages.some((message: any) => message.setupBusy === false));
    assert.equal(controller.channelOverride, '');
  } finally {
    controller.dispose();
  }
});

it('failed browser installation returns recovery guidance and does not launch a browser', async () => {
  installProjectDependencies();
  const controller: any = new SelectorIntelligence(context);
  controller.show();
  await controller.handle({ type: 'ready' });
  state.exitCode = 1;
  try {
    await controller.handle({ type: 'setup', action: 'installChromium' });
    const message = state.panels.at(-1).webview.posted.at(-1);
    assert.equal(message.errorCode, 'browser-missing');
    assert.match(message.error, /installation terminal/);
    assert.equal(controller.worker, undefined);
  } finally {
    controller.dispose();
  }
});

it('browser recovery is allowlisted, requires trust and does not change workspace settings', async () => {
  const controller: any = new SelectorIntelligence(context);
  controller.show();
  await controller.handle({ type: 'ready' });
  try {
    await assert.rejects(controller.handle({ type: 'setup', action: 'arbitraryCommand' }));
    await controller.handle({ type: 'setup', action: 'useChrome' });
    assert.equal(controller.channelOverride, 'chrome');
    assert.equal(state.settings.selectorBrowserChannel, undefined);
    await controller.handle({ type: 'setup', action: 'openGuide' });
    assert.ok(state.calls.some((call: any[]) => call[0] === 'markdown.showPreview'));
    workspace.isTrusted = false;
    await assert.rejects(controller.handle({ type: 'setup', action: 'installChromium' }), /Trust/);
    assert.equal(state.tasks.length, 0);
  } finally {
    workspace.isTrusted = true;
    controller.dispose();
  }
});
it('selector command requires trust before opening a browser panel', () => {
  const controller = new SelectorIntelligence(context);
  workspace.isTrusted = false;
  assert.throws(() => controller.show(), /Trust/);
  assert.equal(state.panels.length, 0);
  workspace.isTrusted = true;
  controller.dispose();
});

for (const [action] of features) {
  it(`Intelligence dashboard routes ${action} and acknowledges completion`, async () => {
    const calls: string[] = [];
    const panel = new IntelligencePanel(async (id) => {
      calls.push(id);
    });
    panel.show(root);
    const view = state.panels.at(-1);
    await view.receive({ action });
    assert.deepEqual(calls, [action]);
    assert.equal(view.webview.posted.at(-1).busy, false);
    panel.dispose();
  });
}
it('Intelligence panel reports actionable errors and permits retry', async () => {
  let attempt = 0;
  const panel = new IntelligencePanel(async () => {
    if (++attempt === 1) throw new Error('Open the original failing test file first.');
  });
  panel.show(root);
  const view = state.panels.at(-1);
  await view.receive({ action: 'verifyRepair' });
  assert.equal(view.webview.posted.at(-1).error, true);
  assert.match(view.webview.posted.at(-1).message, /original failing test/);
  await view.receive({ action: 'verifyRepair' });
  assert.equal(attempt, 2);
  assert.equal(view.webview.posted.at(-1).busy, false);
  panel.dispose();
});
it('Intelligence ignores duplicate clicks but still allows cancelling the active action', async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const panel = new IntelligencePanel(async (id) => {
    calls.push(id);
    if (id !== 'cancelWorkflow')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  panel.show(root);
  const view = state.panels.at(-1);
  const pending = view.receive({ action: 'investigateFailures' });
  await view.receive({ action: 'investigateFailures' });
  await view.receive({ action: 'cancelWorkflow' });
  assert.deepEqual(calls, ['investigateFailures', 'cancelWorkflow']);
  finish();
  await pending;
  panel.dispose();
});
it('Cancel All Runs cancels the experiment loop, not only its current task', async () => {
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules))
    fs.symlinkSync(
      path.resolve(__dirname, '../node_modules'),
      modules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), 'export default {};');
  const controller: any = new IntelligenceController(context, store);
  await controller.experiment(
    root,
    'cancellation',
    async (_workspace: unknown, cancelled: () => boolean) => {
      assert.equal(cancelled(), false);
      stopAllRuns();
      assert.equal(cancelled(), true);
    },
  );
  controller.dispose();
});
