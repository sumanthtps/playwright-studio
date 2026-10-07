import { it, beforeEach, afterEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureProcess } from '../src/processCapture';
import { atomicWriteFile } from '../src/fileSecurity';
import { boundedHistory, loadRunHistory, MAX_HISTORY_BYTES } from '../src/runHistory';
import { ResultStore, RunRecord } from '../src/resultStore';
import { parseReportJson } from '../src/resultParser';
import { buildRunCommand } from '../src/config';
import { PlaywrightTestExplorer } from '../src/testExplorer';
import { setResultsBaseDir, getResultsFilePath } from '../src/resultsPath';
import { reset, state, workspace, Uri, EventEmitter } from './vscodeMock';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-production-')));
let root: string, storage: string, context: any, store: ResultStore | undefined;
let created: EventEmitter<any>,
  changed: EventEmitter<any>,
  deleted: EventEmitter<any>,
  watcherDisposals: number;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(base, 'app-'));
  storage = path.join(root, '.storage');
  fs.mkdirSync(storage);
  reset(root);
  setResultsBaseDir(storage);
  context = {
    storageUri: Uri.file(storage),
    globalStorageUri: Uri.file(storage),
    subscriptions: [],
  };
  created = new EventEmitter();
  changed = new EventEmitter();
  deleted = new EventEmitter();
  watcherDisposals = 0;
  (workspace as any).createFileSystemWatcher = () => ({
    onDidCreate: created.event,
    onDidChange: changed.event,
    onDidDelete: deleted.event,
    dispose: () => {
      watcherDisposals++;
      created.dispose();
      changed.dispose();
      deleted.dispose();
    },
  });
});
afterEach(() => {
  store?.dispose();
  store = undefined;
});
after(() => fs.rmSync(base, { recursive: true, force: true }));
const record = (id: string, workspaceRoot = root): RunRecord => ({
  id,
  capturedAt: new Date(),
  workspaceRoot,
  rootDir: workspaceRoot,
  specs: [
    {
      file: path.join(workspaceRoot, 'a.spec.ts'),
      title: 'a',
      line: 0,
      status: 'passed',
      duration: 1,
    },
  ],
  summary: { passed: 1, failed: 0, flaky: 0, skipped: 0, duration: 1, startTime: new Date() },
});
const report = (line = 1) =>
  JSON.stringify({
    config: { rootDir: root },
    suites: [
      {
        specs: [
          {
            title: 'a',
            file: 'a.spec.ts',
            line,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          },
        ],
      },
    ],
  });

it('file filters do not run similarly named TypeScript/TSX files or sibling paths', () => {
  const file = path.join(root, 'a.spec.ts');
  const filter = buildRunCommand(file).args.find((arg) => arg.includes('a\\.spec'))!;
  const regex = new RegExp(filter);
  assert.ok(regex.test(file.replace(/\\/g, '/')));
  assert.ok(!regex.test(file.replace(/\\/g, '/') + 'x'));
  assert.ok(!regex.test(file.replace(/\\/g, '/') + '/other.spec.ts'));
  assert.ok(buildRunCommand(file, { line: 5 }).args.some((arg) => arg.endsWith('$:6')));
});
it('report coordinates are bounded integers and NUL paths are rejected', () => {
  assert.equal(parseReportJson(report(1.5), root)!.specs[0].line, 0);
  assert.equal(parseReportJson(report(1e100), root)!.specs[0].line, 0x7ffffffe);
  assert.equal(parseReportJson(report().replace('a.spec.ts', 'a\\u0000.spec.ts'), root), null);
});
it('history ignores malformed records without discarding valid neighboring runs', () => {
  const good = record('good');
  const bad = { ...record('bad'), specs: [{ ...good.specs[0], attachments: [null] }] };
  const file = path.join(storage, 'history.json');
  fs.writeFileSync(file, JSON.stringify([null, bad, { ...good, capturedAt: 'invalid' }, good]));
  const loaded = loadRunHistory(file);
  assert.deepEqual(
    loaded.map((r) => r.id),
    ['good'],
  );
  assert.ok(loaded[0].summary.startTime instanceof Date);
});
it('oversized history is rejected before reading its contents', () => {
  const file = path.join(storage, 'large.json');
  fs.writeFileSync(file, '[]');
  fs.truncateSync(file, MAX_HISTORY_BYTES + 1);
  assert.deepEqual(loadRunHistory(file), []);
});
it('history has a byte budget, count cap and sanitized per-root limit', () => {
  const large = {
    ...record('large'),
    specs: [{ ...record('s').specs[0], output: 'x'.repeat(9 * 1024 * 1024) }],
  };
  const bounded = boundedHistory([large, { ...large, id: 'older' }, record('small')], Infinity);
  assert.ok(Buffer.byteLength(bounded.json) <= MAX_HISTORY_BYTES);
  assert.deepEqual(
    bounded.records.map((r) => r.id),
    ['large', 'small'],
  );
  assert.equal(boundedHistory([record('new'), record('old')], 1).records.length, 1);
  assert.equal(
    boundedHistory(
      Array.from({ length: 600 }, (_, i) => record(String(i), '/root/' + i)),
      500,
    ).records.length,
    500,
  );
});
it('atomic history writes preserve hardlink targets', () => {
  const sentinel = path.join(root, 'sentinel');
  fs.writeFileSync(sentinel, 'keep');
  const file = path.join(storage, 'history.json');
  fs.linkSync(sentinel, file);
  atomicWriteFile(file, '[]');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  assert.equal(fs.readFileSync(file, 'utf8'), '[]');
});
it('history ignores predictable temporary symlinks', { skip: process.platform === 'win32' }, () => {
  const sentinel = path.join(root, 'sentinel');
  fs.writeFileSync(sentinel, 'keep');
  fs.symlinkSync(sentinel, path.join(storage, 'run-history.json.tmp'));
  store = new ResultStore(context);
  store.clearHistory();
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});
it('result polling remembers invalid files and recovers after a rewrite', () => {
  store = new ResultStore(context);
  const file = getResultsFilePath(root);
  fs.writeFileSync(file, '{');
  (store as any).tryLoad(file);
  assert.equal((store as any)._mtimes.size, 1);
  assert.equal(store.results, null);
  fs.writeFileSync(file, report());
  (store as any).tryLoad(file);
  assert.equal(store.results!.specs.length, 1);
});
it('result lookup chooses the nearest ancestor without bleeding child projects into a parent', () => {
  store = new ResultStore(context);
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  (store as any)._resultsByRoot.set(nested, record('nested', nested));
  assert.equal(store.getResultsFor(root), null);
  (store as any)._resultsByRoot.set(root, record('root'));
  state.settings.workingDirectory = 'nested/deeper';
  assert.equal((store.getResultsFor(root) as RunRecord).id, 'nested');
});
it('result watcher starts once, debounces writes and cancels pending work on disposal', async () => {
  store = new ResultStore(context);
  store.start();
  store.start();
  assert.equal(changed.listeners.size, 1);
  const file = getResultsFilePath(root);
  fs.writeFileSync(file, report());
  changed.fire(Uri.file(file));
  changed.fire(Uri.file(file));
  assert.equal((store as any).reloadTimers.size, 1);
  store.dispose();
  store = undefined;
  assert.equal(watcherDisposals, 1);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(fs.existsSync(path.join(storage, 'run-history.json')), false);
});
it('CLI capture keeps stdout JSON separate and preserves literal arguments', async () => {
  const args = ['spaces and quotes "', '$(echo injected)', '&echo injected', '%PATH%', '!PATH!'];
  const result = await captureProcess(
    {
      executable: process.execPath,
      args: [
        '-e',
        'console.log(JSON.stringify(process.argv.slice(1))); console.error("warning");',
        ...args,
      ],
    },
    { cwd: root },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.stdout), args);
  assert.match(result.stderr, /warning/);
});
it('CLI capture rejects missing executables, excessive output and hung processes', async () => {
  const missing = await captureProcess(
    { executable: path.join(root, 'missing-command'), args: [] },
    {},
  );
  assert.equal(missing.ok, false);
  assert.ok(missing.error);
  const noisy = await captureProcess(
    {
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)'],
    },
    {},
    5000,
    1024,
  );
  assert.match(noisy.error!, /exceeds/);
  assert.ok(Buffer.byteLength(noisy.stdout) <= 1024);
  const hung = await captureProcess(
    { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
    {},
    100,
  );
  assert.equal(hung.error, 'Timed out');
});
it('CLI probes close stdin so programs waiting for EOF can finish', async () => {
  const result = await captureProcess(
    {
      executable: process.execPath,
      args: ['-e', 'process.stdin.resume();process.stdin.on("end",()=>console.log("done"));'],
    },
    {},
    2000,
  );
  assert.equal(result.ok, true);
  assert.match(result.stdout, /done/);
});
it('Test Explorer reports global errors and nonzero exits instead of a false pass', () => {
  const explorer: any = Object.create(PlaywrightTestExplorer.prototype);
  const target = { file: path.join(root, 'a.spec.ts') };
  explorer.targets = new Map([['case', target]]);
  explorer.matchingResult = () => record('r').specs[0];
  let errors = ['global teardown failed'];
  explorer.store = { getResultsFor: () => ({ errors }) };
  const calls: string[] = [];
  const run = { errored: () => calls.push('errored'), passed: () => calls.push('passed') };
  explorer.applyResult(run, { id: 'case' }, 1, true);
  errors = [];
  explorer.applyResult(run, { id: 'case' }, 1, true);
  assert.deepEqual(calls, ['errored', 'errored']);
});
it('Test Explorer closes and errors a run when task launch fails', async () => {
  const explorer: any = Object.create(PlaywrightTestExplorer.prototype);
  explorer.requestedItems = () => [{ id: 'case' }];
  explorer.executeItems = async () => {
    throw new Error('spawn failed');
  };
  const calls: string[] = [];
  explorer.controller = {
    createTestRun: () => ({ errored: () => calls.push('errored'), end: () => calls.push('end') }),
  };
  await explorer.run({}, { isCancellationRequested: false }, false);
  assert.deepEqual(calls, ['errored', 'end']);
});

it('Test Explorer Inspector launches the selected file with --debug and preserves project filtering', async () => {
  const explorer: any = Object.create(PlaywrightTestExplorer.prototype);
  explorer.targets = new Map([
    ['file', { file: path.join(root, 'a.spec.ts'), kind: 'file', projectName: 'chromium' }],
  ]);
  explorer.store = { getResultsFor: () => null };
  explorer.waitForFreshResults = async () => false;
  explorer.applyResult = () => {};
  const cancelled = new EventEmitter<void>();
  try {
    await explorer.executeItems(
      { started: () => {} },
      [{ id: 'file', label: 'a.spec.ts' }],
      { isCancellationRequested: false, onCancellationRequested: cancelled.event },
      false,
      true,
    );
    const args = (state.tasks.at(-1)!.execution as any).args as string[];
    assert.ok(args.includes('--debug'));
    assert.ok(!args.includes('--headed'));
    assert.equal(args[args.indexOf('--project') + 1], 'chromium');
  } finally {
    cancelled.dispose();
  }
});
