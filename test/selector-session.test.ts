import { after, afterEach, beforeEach, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { SelectorIntelligence } from '../src/selectors/controller';
import { BrowserReply, parseSelectorViewState } from '../src/selectors/protocol';
import { env, reset, state, tasks, Uri, workspace } from './vscodeMock';

const processes = require('node:child_process') as typeof import('node:child_process');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-selector-session-')));
const context: any = { extensionUri: Uri.file(path.resolve(__dirname, '..')) };
const inspection = {
  tag: 'input',
  text: 'Email',
  frameUrl: 'http://localhost/form',
  candidates: [
    {
      kind: 'Playwright label',
      code: 'page.getByLabel("Email")',
      matches: 1,
      unique: true,
      score: 90,
      reason: 'Accessible label',
    },
  ],
};
class FakeWorker extends EventEmitter {
  sent: { id: number; action: { type: string } }[] = [];
  stderr = { resume() {} };
  pid = undefined;
  send(message: { id: number; action: { type: string } }, callback: (error: null) => void) {
    this.sent.push(message);
    callback(null);
  }
  respond(message: Omit<BrowserReply, 'id'>) {
    this.emit('message', { id: this.sent.at(-1)!.id, ...message });
  }
}
let workers: FakeWorker[];
let controllers: SelectorIntelligence[];
beforeEach(() => {
  reset(root);
  workspace.isTrusted = true;
  workers = [];
  controllers = [];
  mock.method(processes, 'fork', () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
});
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  mock.restoreAll();
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
function controller(): any {
  const controller = new SelectorIntelligence(context);
  controllers.push(controller);
  controller.show();
  return controller;
}
async function openPage(controller: any): Promise<FakeWorker> {
  await controller.handle({ type: 'ready' });
  await controller.handle({ type: 'navigate', url: 'http://localhost/form' });
  const worker = workers.at(-1)!;
  worker.respond({
    url: 'http://localhost/form',
    screenshot: 'first-image',
    browserName: 'Chrome',
  });
  return worker;
}

it('opening and reopening an empty panel waits for ready and never launches a browser', async () => {
  const app = controller();
  assert.equal(state.panels.at(-1).webview.posted.length, 0);
  state.panels.at(-1).dispose();
  app.show();
  await app.handle({ type: 'ready' });
  assert.equal(workers.length, 0);
  assert.equal(state.panels.at(-1).webview.posted.at(-1).uiState.mode, 'inspect');
});

it('reopening retains the live page, project, mode, draft address and copyable inspection', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'inspect', x: 20, y: 30 });
  worker.respond({ screenshot: 'inspected-image', inspection });
  const uiState = { mode: 'browse', address: 'http://localhost/unsent', selectorScroll: 128 };
  await app.handle({ type: 'viewState', state: uiState });
  const oldPanel = state.panels.at(-1);
  oldPanel.dispose();
  state.settings.workingDirectory = 'a-different-project';
  app.show();
  const reopened = state.panels.at(-1);
  assert.equal(app.worker, worker);
  assert.equal(app.root, root);
  assert.equal(reopened.webview.posted.length, 0);
  await app.handle({ type: 'ready' });
  const restored = reopened.webview.posted.at(-1);
  assert.deepEqual(restored.uiState, uiState);
  assert.equal(restored.screenshot, 'inspected-image');
  assert.deepEqual(restored.inspection, inspection);
  assert.equal(restored.sessionBusy, true);
  assert.equal(restored.sessionAction, 'refresh');
  assert.equal(workers.length, 1);
  assert.deepEqual(
    worker.sent.map((message) => message.action.type),
    ['navigate', 'inspect', 'refresh'],
  );
  await app.handle({ type: 'copy', index: 0, format: 'playwright' });
  assert.equal(state.clipboard, inspection.candidates[0].code);
  worker.respond({ screenshot: 'fresh-image', url: 'http://localhost/form' });
  assert.equal(reopened.webview.posted.at(-1).screenshot, 'fresh-image');
  await oldPanel.receive({ type: 'viewState', state: { mode: 'inspect' } });
  assert.deepEqual(app.uiState, uiState, 'Disposed webviews cannot overwrite current state.');
});

it('work finishing while the panel is closed becomes the restored state', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'click', x: 20, y: 30 });
  state.panels.at(-1).dispose();
  worker.respond({ screenshot: 'after-click', url: 'http://localhost/next' });
  app.show();
  await app.handle({ type: 'ready' });
  const restored = state.panels.at(-1).webview.posted.at(-1);
  assert.equal(restored.screenshot, 'after-click');
  assert.equal(restored.url, 'http://localhost/next');
  assert.equal(restored.inspection, undefined);
  assert.equal(workers.length, 1);
});

it('a slow DevTools launch keeps the website worker alive and clears its deadline on success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'devtools' });
  t.mock.timers.tick(35000);
  assert.equal(app.worker, worker, 'Desktop Chrome may need longer than ordinary actions.');
  worker.respond({ devtoolsOpen: true });
  t.mock.timers.tick(60000);
  assert.equal(app.worker, worker, 'A completed launch must cancel its watchdog.');
  assert.equal(state.panels.at(-1).webview.posted.at(-1).devtoolsOpen, true);
});

it('an unresponsive DevTools launch still reaches a bounded deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = controller();
  await openPage(app);
  await app.handle({ type: 'devtools' });
  t.mock.timers.tick(60000);
  assert.equal(app.worker, undefined);
  assert.match(state.panels.at(-1).webview.posted.at(-1).error, /stopped responding/);
});

it('a copy finishing after its panel closes cannot acknowledge a different panel', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'inspect', x: 20, y: 30 });
  worker.respond({ inspection });
  let finish!: () => void;
  mock.method(env.clipboard, 'writeText', async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const copying = app.handle({ type: 'copy', index: 0, format: 'playwright' });
  state.panels.at(-1).dispose();
  app.show();
  await app.handle({ type: 'ready' });
  finish();
  await copying;
  assert.ok(!state.panels.at(-1).webview.posted.some((message: any) => message.type === 'copied'));
  assert.deepEqual(app.inspection, inspection);
});

it('reopening during an action restores busy state and waits for its existing reply', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'type', text: 'private form input' });
  state.panels.at(-1).dispose();
  app.show();
  await app.handle({ type: 'ready' });
  const restored = state.panels.at(-1).webview.posted.at(-1);
  assert.equal(restored.sessionBusy, true);
  assert.equal(restored.sessionAction, 'type');
  assert.equal(worker.sent.length, 2, 'Ready must not interrupt or duplicate the pending action.');
  assert.ok(!JSON.stringify(restored).includes('private form input'));
  worker.respond({ screenshot: 'typed-image' });
  assert.equal(state.panels.at(-1).webview.posted.at(-1).screenshot, 'typed-image');
});

it('replies received before the new webview is ready remain cached instead of being lost', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'inspect', x: 20, y: 30 });
  state.panels.at(-1).dispose();
  app.show();
  worker.respond({ screenshot: 'late-inspection', inspection });
  assert.equal(state.panels.at(-1).webview.posted.length, 0);
  await app.handle({ type: 'ready' });
  assert.equal(state.panels.at(-1).webview.posted.at(-1).screenshot, 'late-inspection');
  assert.deepEqual(state.panels.at(-1).webview.posted.at(-1).inspection, inspection);
});

it('view state validation bounds untrusted fields and replaces cleared drafts', async () => {
  for (const value of [
    null,
    { mode: 'execute' },
    { mode: 'inspect', address: 'x'.repeat(8193) },
    { mode: 'browse', selectorScroll: -1 },
    { mode: 'browse', selectorScroll: Infinity },
  ])
    assert.equal(parseSelectorViewState(value), undefined);
  assert.deepEqual(parseSelectorViewState({ mode: 'browse', password: 'do not retain' }), {
    mode: 'browse',
  });
  const app = controller();
  await app.handle({ type: 'viewState', state: { mode: 'browse', address: 'draft' } });
  await app.handle({ type: 'viewState', state: { mode: 'browse' } });
  assert.deepEqual(app.uiState, { mode: 'browse' });
});

it('an explicit browser close and extension disposal release the session', async () => {
  const app = controller();
  await openPage(app);
  await app.handle({ type: 'close' });
  assert.equal(app.worker, undefined);
  assert.equal(app.cachedReply.screenshot, undefined);
  state.panels.at(-1).dispose();
  app.show();
  await app.handle({ type: 'ready' });
  assert.equal(workers.length, 1);
  assert.equal(state.panels.at(-1).webview.posted.at(-1).screenshot, undefined);
  app.dispose();
  app.show();
  assert.equal(state.panels.length, 2, 'A disposed controller cannot start another session.');
});

it('browser installation continues safely when its panel closes and a new panel opens', async () => {
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules))
    fs.symlinkSync(
      path.resolve(__dirname, '../node_modules'),
      modules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  const executeTask = tasks.executeTask.bind(tasks);
  let finish!: () => void;
  mock.method(tasks, 'executeTask', async (task: any) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return executeTask(task);
  });
  const app = controller();
  await app.handle({ type: 'ready' });
  const installing = app.handle({ type: 'setup', action: 'installChromium' });
  assert.ok(app.setupCancellation);
  state.panels.at(-1).dispose();
  app.show();
  await app.handle({ type: 'ready' });
  assert.equal(state.panels.at(-1).webview.posted.at(-1).setupBusy, true);
  finish();
  await installing;
  assert.equal(app.setupCancellation, undefined);
  assert.equal(state.panels.at(-1).webview.posted.at(-1).setupBusy, false);
  assert.equal(app.channelOverride, '');
  assert.equal(workers.length, 0);
});

it('only an explicit pending clipboard action writes selected text, which is never cached or posted', async () => {
  const app = controller();
  const worker = await openPage(app);
  state.clipboard = 'unchanged';
  await app.handle({ type: 'refresh' });
  worker.respond({ clipboardText: 'unsolicited text' });
  assert.equal(state.clipboard, 'unchanged');
  await app.handle({ type: 'clipboard', operation: 'copy' });
  worker.respond({ clipboardText: 'selected text' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.clipboard, 'selected text');
  assert.equal(app.cachedReply.clipboardText, undefined);
  assert.ok(
    state.panels.at(-1).webview.posted.every((message: any) => message.clipboardText === undefined),
  );
  await app.handle({ type: 'clipboard', operation: 'copy' });
  worker.respond({ clipboardText: 'x'.repeat(100001) });
  assert.equal(state.clipboard, 'selected text');
  assert.match(state.panels.at(-1).webview.posted.at(-1).error, /too large/);
});

it('ancillary errors preserve the pending browser operation and explicit close acknowledges completion', async () => {
  const app = controller();
  const worker = await openPage(app);
  await app.handle({ type: 'type', text: 'still pending' });
  app.reportError(new Error('Guide could not open'));
  const error = state.panels.at(-1).webview.posted.at(-1);
  assert.equal(error.sessionBusy, true);
  assert.equal(error.sessionAction, 'type');
  worker.respond({ screenshot: 'completed' });
  assert.equal(app.pending, undefined);
  await app.handle({ type: 'close' });
  assert.equal(state.panels.at(-1).webview.posted.at(-1).sessionClosed, true);
});
