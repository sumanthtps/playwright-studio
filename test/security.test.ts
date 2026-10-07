import { it, beforeEach, afterEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBoundedFile, readableFileInRoots, replaceReviewedFile } from '../src/fileSecurity';
import { injectJsonReporter } from '../src/setupHelpers';
import { sourceFiles } from '../src/intelligence/execution';
import { localFile, digest } from '../src/intelligence/model';
import { relativeFile } from '../src/intelligence/labModel';
import { parseCapsule, portableFile } from '../src/intelligence/capsule';
import { attachmentJson } from '../src/intelligence/labRuntime';
import { ArtifactViewer } from '../src/artifactViewer';
import { IntelligencePanel } from '../src/intelligence/panel';
import { parseCoverageJson } from '../src/coverageImporter';
import { runCommand, runCommandAndWait, debugCommand } from '../src/terminal';
import { getPlaywrightProjectGraph } from '../src/playwrightProjects';
import { registerCommands } from '../src/commands';
import { reset, state, workspace, Uri, commands } from './vscodeMock';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-security-')));
let root: string;
let viewer: ArtifactViewer | undefined;
let context: any;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(base, 'workspace-'));
  reset(root);
  workspace.isTrusted = true;
  const storage = path.join(root, '.storage');
  fs.mkdirSync(storage);
  context = {
    extensionUri: Uri.file(root),
    storageUri: Uri.file(storage),
    globalStorageUri: Uri.file(storage),
    subscriptions: [],
    workspaceState: { get() {}, update() {} },
  };
});
afterEach(() => {
  viewer?.dispose();
  viewer = undefined;
  workspace.isTrusted = true;
});
after(() => fs.rmSync(base, { recursive: true, force: true }));
const spec = (attachments: any[]) => ({
  title: 'review',
  file: path.join(root, 'case.spec.ts'),
  line: 0,
  status: 'failed' as const,
  duration: 10,
  attachments,
});
const outside = (content = 'PRIVATE_FIXTURE_SENTINEL') => {
  const file = path.join(base, `outside-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, content);
  return file;
};

it(
  'workspace writes reject dangling links to missing external files',
  { skip: process.platform === 'win32' },
  () => {
    const target = path.join(base, 'must-not-be-created');
    fs.symlinkSync(target, path.join(root, 'link'));
    assert.throws(() => fs.writeFileSync(localFile(root, 'link'), 'attacker'), /link|boundary/);
    assert.equal(fs.existsSync(target), false);
  },
);
it(
  'workspace writes reject dangling directory links before mkdir',
  { skip: process.platform === 'win32' },
  () => {
    const target = path.join(base, 'missing-directory');
    fs.symlinkSync(target, path.join(root, 'directory'));
    assert.throws(() => localFile(root, 'directory/new.json'), /link|boundary/);
    assert.equal(fs.existsSync(target), false);
  },
);
it('portable imports reject traversal, alternate streams and reserved Windows names on every OS', () => {
  for (const file of [
    '../escape',
    '/tmp/escape',
    'C:/escape',
    'x\\y',
    'x:payload',
    'NUL',
    'sub/CON.txt',
    'COM1.log',
    'LPT²',
    'trailing.',
    'space /file',
    'x\0y',
  ]) {
    assert.throws(() => relativeFile(root, file), /relative file path|workspace/, file);
  }
  assert.equal(relativeFile(root, 'tests/checkout.spec.ts'), 'tests/checkout.spec.ts');
});
it('artifact path authorization rejects outside files and sibling-prefix directories', () => {
  const secret = outside();
  assert.equal(readableFileInRoots(secret, [root]), undefined);
  const sibling = root + '-sibling';
  fs.mkdirSync(sibling);
  const file = path.join(sibling, 'secret.txt');
  fs.writeFileSync(file, 'secret');
  assert.equal(readableFileInRoots(file, [root]), undefined);
  const local = path.join(root, 'safe.txt');
  fs.writeFileSync(local, 'safe');
  assert.equal(readableFileInRoots(local, [root]), local);
});
it(
  'artifact path authorization rejects symlink escapes',
  { skip: process.platform === 'win32' },
  () => {
    const file = path.join(root, 'link.txt');
    fs.symlinkSync(outside(), file);
    assert.equal(readableFileInRoots(file, [root]), undefined);
  },
);
it('artifact reports cannot read external text or expand webview filesystem permissions', async () => {
  const secret = outside();
  viewer = new ArtifactViewer(context);
  viewer.show(spec([{ name: 'output', path: secret, contentType: 'text/plain' }]));
  const panel = state.panels.at(-1);
  assert.ok(!panel.webview.html.includes('PRIVATE_FIXTURE_SENTINEL'));
  assert.ok(!panel.options.localResourceRoots.some((uri: Uri) => uri.fsPath === base));
  await (viewer as any).handleMessage({ type: 'open', path: secret });
  assert.ok(!state.calls.some((c) => c[0] === 'vscode.open'));
  await (viewer as any).handleMessage(null);
});
it('artifact review still renders allowed text and preserves HTML escaping', () => {
  const file = path.join(root, 'output.txt');
  fs.writeFileSync(file, '<script>untrusted()</script>');
  viewer = new ArtifactViewer(context);
  viewer.show(spec([{ name: 'output', path: file, contentType: 'text/plain' }]));
  const html = state.panels.at(-1).webview.html;
  assert.ok(html.includes('&lt;script&gt;untrusted()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>untrusted()'));
});
function snapshots(expected?: string) {
  const actual = path.join(root, 'actual.txt');
  fs.writeFileSync(actual, 'new snapshot');
  expected ??= path.join(root, 'expected.txt');
  if (!fs.existsSync(expected)) fs.writeFileSync(expected, 'old snapshot');
  viewer = new ArtifactViewer(context);
  viewer.show(
    spec([
      { name: 'actual', path: actual },
      { name: 'expected', path: expected },
    ]),
  );
  return { actual, expected };
}
it('snapshot acceptance rejects files changed during the confirmation dialog', async () => {
  const { actual, expected } = snapshots();
  state.messages.push(() => {
    fs.writeFileSync(actual, 'unreviewed payload');
    return 'Accept Snapshot';
  });
  await assert.rejects((viewer as any).handleMessage({ type: 'accept', path: actual }), /changed/);
  assert.equal(fs.readFileSync(expected, 'utf8'), 'old snapshot');
});
it(
  'snapshot acceptance rejects a destination symlink swapped during confirmation',
  { skip: process.platform === 'win32' },
  async () => {
    const { actual, expected } = snapshots();
    const secret = outside();
    state.messages.push(() => {
      fs.unlinkSync(expected);
      fs.symlinkSync(secret, expected);
      return 'Accept Snapshot';
    });
    await assert.rejects(
      (viewer as any).handleMessage({ type: 'accept', path: actual }),
      /changed/,
    );
    assert.equal(fs.readFileSync(secret, 'utf8'), 'PRIVATE_FIXTURE_SENTINEL');
  },
);
it('accepted snapshots replace hardlinks without overwriting the external linked file', async () => {
  const linked = outside('old snapshot');
  const expected = path.join(root, 'expected.txt');
  fs.linkSync(linked, expected);
  const { actual } = snapshots(expected);
  state.messages.push('Accept Snapshot');
  await (viewer as any).handleMessage({ type: 'accept', path: actual });
  assert.equal(fs.readFileSync(expected, 'utf8'), 'new snapshot');
  assert.equal(fs.readFileSync(linked, 'utf8'), 'old snapshot');
});
it('JSON evidence reads require a host-owned output root, never a report-supplied path grant', () => {
  const file = outside('{"secret":"outside"}');
  assert.equal(attachmentJson({ name: 'studio-behavior', path: file }, [root]), undefined);
  const local = path.join(root, 'metrics.json');
  fs.writeFileSync(local, '{"completed":true}');
  assert.equal(attachmentJson({ name: 'studio-behavior', path: local }), undefined);
  assert.deepEqual(attachmentJson({ name: 'studio-behavior', path: local }, [root]), {
    completed: true,
  });
});
it('bounded import reads reject oversized files and directories', () => {
  const file = path.join(root, 'large.json');
  fs.writeFileSync(file, '');
  fs.truncateSync(file, 1025);
  assert.throws(() => readBoundedFile(file, 1024), /size limit/);
  assert.throws(() => readBoundedFile(root, 1024), /regular|EISDIR/);
  fs.writeFileSync(file, 'small');
  assert.equal(readBoundedFile(file, 1024).toString(), 'small');
});
it(
  'FIFO imports fail without waiting for a writer',
  { skip: process.platform === 'win32', timeout: 2000 },
  () => {
    const file = path.join(root, 'named-pipe');
    execFileSync('mkfifo', [file]);
    assert.throws(() => readBoundedFile(file, 1024), /regular/);
  },
);
it('capsule exclusions cover credential files and case-insensitive aliases', () => {
  for (const file of [
    '.ENV.production',
    '.GIT/config',
    '.ssh/id_rsa',
    '.aws/config',
    '.npmrc',
    '.git-credentials',
    'nested/.netrc',
    'id_ed25519',
    '.docker/config.json',
  ])
    assert.equal(portableFile(file), false, file);
  assert.equal(portableFile('src/checkout.ts'), true);
});
it('capsules accept a valid 4 MB file without regexp stack exhaustion and reject noncanonical encoding', () => {
  const files = ['playwright.config.ts', 'case.spec.ts', 'asset.bin'].map((file, i) => {
    const bytes = i === 2 ? Buffer.alloc(4 * 1024 * 1024, 'a') : Buffer.from('source');
    return { file, content: bytes.toString('base64'), sha256: digest(bytes) };
  });
  const capsule = {
    version: 1,
    kind: 'playwright-studio-capsule',
    name: 'test',
    createdAt: 'now',
    revision: { capturedAt: 'now' },
    runtime: { node: '22', platform: 'test', arch: 'test', playwright: 'test' },
    files,
    tests: [{ file: 'case.spec.ts', title: 'case' }],
    expectedFailure: 'failure',
    seed: 1,
    notes: 'fixture',
  };
  assert.equal(parseCapsule(root, capsule).files.length, 3);
  for (const content of ['====', 'YQ', 'YQ==\n', 'YR==', 'a'.repeat(6 * 1024 * 1024)]) {
    assert.throws(
      () =>
        parseCapsule(root, { ...capsule, files: [{ ...files[0], content }, ...files.slice(1)] }),
      /encoding|size limits/,
    );
  }
});
it('native and direct process entry points reject untrusted workspaces before launch', async () => {
  workspace.isTrusted = false;
  const invocation = {
    executable: process.execPath,
    args: ['-e', 'throw new Error("must never run")'],
  };
  await assert.rejects(runCommand(invocation), /Trust/);
  await assert.rejects(runCommandAndWait(invocation), /Trust/);
  await assert.rejects(debugCommand(invocation), /Trust/);
  await assert.rejects(getPlaywrightProjectGraph(root), /Trust/);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.debug.length, 0);
});
it('workspace-configured gallery URLs cannot launch other applications or command URI handlers', async () => {
  registerCommands(
    context,
    {} as any,
    {} as any,
    { history: [] } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  state.settings.componentGalleryUrl = 'vscode://malicious.extension/run';
  state.picks.push(0);
  await commands.executeCommand('playwrightSnippets.openComponentGallery');
  assert.match(state.errors[0], /http or https/);
  assert.ok(!state.calls.some((c) => c[0] === 'external'));
});
it('webviews accept only actions exposed by the current rendered workflow', async () => {
  const calls: string[] = [];
  const panel = new IntelligencePanel(async (id) => {
    calls.push(id);
  });
  try {
    panel.show(root);
    const webview = state.panels.at(-1);
    await webview.receive({ action: 'runLaw' });
    assert.deepEqual(calls, []);
    await webview.receive({ action: 'checkProductLaws' });
    assert.deepEqual(calls, ['checkProductLaws']);
    panel.show(root, {
      title: 'Product Laws',
      introduction: '',
      sections: [],
      actions: [{ id: 'runLaw', title: 'Run law' }],
    });
    await webview.receive({ action: 'runLaw' });
    assert.equal(calls.at(-1), 'runLaw');
    await webview.receive({ action: 'checkProductLaws' });
    assert.equal(calls.length, 2);
  } finally {
    panel.dispose();
  }
});
it('coverage imports reject external source paths before reading local files', () => {
  const file = outside('private source');
  const report = JSON.stringify({
    result: [
      {
        url: file,
        functions: [
          { functionName: 'secret', ranges: [{ startOffset: 0, endOffset: 1, count: 1 }] },
        ],
      },
    ],
  });
  assert.throws(() => parseCoverageJson(report, root), /readable local files/);
});
it('coverage rejects excessive branch-analysis work before evaluating ranges', () => {
  const location = { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } };
  const statementMap = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, location]));
  const raw = JSON.stringify({
    'app.js': { statementMap, s: {}, branchMap: { 0: { locations: Array(5000).fill(location) } } },
  });
  assert.throws(() => parseCoverageJson(raw, root), /branch analysis limit/);
});
it(
  'reporter setup ignores pre-planted temporary symlinks',
  { skip: process.platform === 'win32' },
  () => {
    const config = path.join(root, 'playwright.config.ts');
    fs.writeFileSync(config, 'export default { retries: 1 };');
    const secret = outside();
    fs.symlinkSync(secret, config + '.playwright-studio.tmp');
    assert.equal(injectJsonReporter(config), true);
    assert.match(fs.readFileSync(config, 'utf8'), /reporter/);
    assert.equal(fs.readFileSync(secret, 'utf8'), 'PRIVATE_FIXTURE_SENTINEL');
  },
);
it('configuration replacement rejects edits made after review', () => {
  const config = path.join(root, 'playwright.config.ts');
  fs.writeFileSync(config, 'changed by user');
  assert.throws(
    () => replaceReviewedFile(config, 'original', 'replacement'),
    /changed since review/,
  );
  assert.equal(fs.readFileSync(config, 'utf8'), 'changed by user');
});
it(
  'source discovery ignores FIFOs with source-file extensions',
  { skip: process.platform === 'win32', timeout: 2000 },
  async () => {
    execFileSync('mkfifo', [path.join(root, 'blocked.ts')]);
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const valid = true;');
    const files = await sourceFiles(root);
    assert.deepEqual(
      files.map((file) => file.file),
      ['app.ts'],
    );
  },
);
