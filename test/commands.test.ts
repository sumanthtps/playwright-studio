import { IntelligenceStorage } from '../src/intelligence/model';
import { beforeEach, after, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerCommands } from '../src/commands';
import { debugCommandAndWait, runCommandAndWait } from '../src/terminal';
import {
  reset,
  state,
  window,
  commands,
  Uri,
  editor,
  tasks,
  EventEmitter,
  CancellationTokenSource,
  Task,
} from './vscodeMock';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-commands-'));
const file = path.join(root, 'example.spec.ts');
fs.writeFileSync(file, "test('example @smoke', async () => {});");
const configFile = path.join(root, 'playwright.config.ts');
const calls: string[] = [];
const exercised = new Set<string>();
const spec = {
  title: 'case [1]',
  file,
  line: 0,
  status: 'failed',
  duration: 100,
  projectName: 'webkit',
  error: '<bad & wrong>',
  attachments: [{ name: 'actual', path: file }],
};
const results = {
  specs: [spec],
  summary: { passed: 0, failed: 1, flaky: 0, skipped: 0, duration: 100, startTime: new Date() },
  rootDir: root,
};
const store = {
  getResultsFor: () => results,
  results,
  history: [
    { ...results, id: 'a', capturedAt: new Date(), workspaceRoot: root },
    { ...results, id: 'b', capturedAt: new Date(0), workspaceRoot: root },
  ],
  clearHistory: () => calls.push('clear'),
};
const context = {
  subscriptions: [],
  extensionUri: Uri.file(path.resolve(__dirname, '..')),
  storageUri: Uri.file(root + '-storage'),
  globalStorageUri: Uri.file(path.join(root, 'User/globalStorage/extension')),
  workspaceState: { get: () => undefined, update: async () => {} },
};
const profiles = {
  switchProfile: async () => calls.push('profile'),
  getProfileNames: () => [],
  getProfileEnv: () => ({ SELECTED_PROFILE: 'yes' }),
};
registerCommands(
  context as any,
  { refresh: () => calls.push('refresh') } as any,
  profiles as any,
  store as any,
  { show: () => calls.push('artifact') } as any,
  {
    importCoverage: () => calls.push('coverage'),
    refresh: () => calls.push('refreshTests'),
    runFromSidebar: (item: any, mode = 'run') => {
      state.calls.push(['sidebarRun', item, mode]);
    },
  } as any,
  { show: () => calls.push('analytics') } as any,
);
beforeEach(() => {
  reset(root);
  calls.length = 0;
  fs.writeFileSync(
    configFile,
    "export default defineConfig({ projects: [{ name: 'chromium' }, { name: 'webkit' }] });",
  );
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(root + '-storage', { recursive: true, force: true });
});
async function execute(name: string, ...args: unknown[]) {
  exercised.add(`playwrightSnippets.${name}`);
  await commands.executeCommand(`playwrightSnippets.${name}`, ...args);
  assert.deepEqual(state.errors, []);
}
function args() {
  return state.tasks.at(-1)!.execution.args;
}
for (const name of [
  'runFile',
  'runTest',
  'inspectFile',
  'inspectTest',
  'debugFile',
  'debugTest',
  'debugInspectFile',
  'debugInspectTest',
]) {
  it(`${name} routes target and mode`, async () => {
    await execute(name, file, 'example', 0);
    const argv = name.startsWith('debug') ? state.debug[0].runtimeArgs : args();
    assert.ok(argv.some((arg: string) => arg.includes('example\\.spec\\.ts')));
    assert.equal(argv.includes('--debug'), /inspect/i.test(name));
  });
}
for (const name of ['runTestAtCursor', 'inspectTestAtCursor'])
  it(name, async () => {
    await execute(name);
    assert.ok(args().some((arg) => arg.endsWith(':1')));
  });
for (const name of ['codeGen', 'openLocatorPicker'])
  it(name, async () => {
    state.inputs.push('http://localhost:3000');
    await execute(name);
    assert.ok(args().includes('codegen'));
  });
it('showTrace accepts results tree arguments', async () => {
  await execute('showTrace', { spec: { traceFile: file } });
  assert.ok(args().includes('show-trace'));
});
it('showReport uses configured path', async () => {
  state.settings.reportPath = 'custom-report';
  await execute('showReport', Uri.file(file));
  assert.equal(args().at(-1), path.join(root, 'custom-report'));
});
it('runWithTag forwards selected tag', async () => {
  await execute('runWithTag', file, '@smoke');
  assert.deepEqual(args().slice(-2), ['--grep', '@smoke']);
});
it('runWithProject emits multiple projects', async () => {
  state.picks.push((items: any[]) => items);
  await execute('runWithProject', file);
  assert.deepEqual(args().slice(-4), ['--project', 'chromium', '--project', 'webkit']);
});
it('environment profile and CodeLens refresh commands', async () => {
  await execute('switchEnvProfile');
  await execute('refreshCodeLens');
  assert.deepEqual(calls, ['profile', 'refresh']);
});
it('runMatrix saves and runs selected options', async () => {
  state.picks.push(
    0,
    (items: any[]) => [items[1]],
    (items: any[]) => items.filter((item) => ['headed', 'workers'].includes(item.id)),
    'Save preset and run',
  );
  state.inputs.push('@smoke', '2', 'Smoke');
  await execute('runMatrix');
  assert.equal(state.settings.runPresets[0].name, 'Smoke');
  assert.ok(args().includes('--headed'));
  assert.deepEqual(args().slice(-2), ['--workers', '2']);
});
it('saved preset preserves all CLI flags and environment override', async () => {
  state.settings.runPresets = [
    {
      name: 'all',
      scope: 'file',
      projects: ['webkit'],
      grep: 'login',
      headed: true,
      trace: 'on',
      workers: 2,
      retries: 3,
      repeatEach: 4,
      lastFailed: true,
      timeout: 500,
      maxFailures: 1,
      grepInvert: 'slow',
      shard: '1/2',
      updateSnapshots: 'missing',
      fullyParallel: true,
      forbidOnly: true,
      failOnFlakyTests: true,
      onlyChanged: true,
      envProfile: 'stage',
    },
  ];
  state.picks.push(0);
  await execute('runPreset');
  for (const flag of [
    '--project',
    '--grep',
    '--headed',
    '--trace',
    '--workers',
    '--retries',
    '--repeat-each',
    '--last-failed',
    '--timeout',
    '--max-failures',
    '--grep-invert',
    '--shard',
    '--update-snapshots',
    '--fully-parallel',
    '--forbid-only',
    '--fail-on-flaky-tests',
    '--only-changed',
  ])
    assert.ok(args().includes(flag), flag);
  assert.equal(state.tasks[0].execution.options.env.SELECTED_PROFILE, 'yes');
});
it('file presets reject a non-test editor', async () => {
  state.settings.runPresets = [{ name: 'file', scope: 'file' }];
  state.picks.push(0);
  window.activeTextEditor = editor(path.join(root, 'app.ts'));
  await commands.executeCommand('playwrightSnippets.runPreset');
  assert.match(state.errors[0], /file-scoped/);
  assert.equal(state.tasks.length, 0);
});
for (const action of ['Rename', 'Duplicate', 'Delete', 'Replace options', 'Run'])
  it(`manageRunPresets: ${action}`, async () => {
    state.settings.runPresets = [{ name: 'one', scope: 'workspace' }];
    state.picks.push(0, action);
    if (action === 'Delete') state.messages.push('Delete');
    else if (action === 'Replace options') {
      state.picks.push(1, [], []);
      state.inputs.push('new');
    } else state.inputs.push('two');
    await execute('manageRunPresets');
    if (action === 'Delete') assert.deepEqual(state.settings.runPresets, []);
    if (action === 'Rename') assert.equal(state.settings.runPresets[0].name, 'two');
    if (action === 'Duplicate') assert.equal(state.settings.runPresets.length, 2);
    if (action === 'Run') assert.equal(state.tasks.length, 1);
  });
it('setupVideoOverride preserves config and permits video preset', async () => {
  state.messages.push('Apply Bridge');
  await execute('setupVideoOverride');
  assert.match(fs.readFileSync(configFile, 'utf8'), /PLAYWRIGHT_STUDIO_VIDEO/);
});
it('setupCaptureResults adds JSON reporter', async () => {
  state.messages.push('Add JSON reporter');
  await execute('setupCaptureResults');
  assert.match(fs.readFileSync(configFile, 'utf8'), /json/);
});
it('runFailed restricts retries to failed case and project', async () => {
  await execute('runFailed');
  assert.deepEqual(args().slice(-4), ['--grep', 'case \\[1\\](?: @\\S+)*$', '--project', 'webkit']);
});
for (const [name, flag] of [
  ['runLastFailed', '--last-failed'],
  ['openUIMode', '--ui'],
  ['watchFile', '--ui'],
  ['installBrowsers', 'install'],
  ['updateBrowsers', '--force'],
])
  it(name, async () => {
    await execute(name);
    assert.ok(args().includes(flag));
  });
it('repeatUntilFailure emits repetition and fail-fast settings', async () => {
  state.inputs.push('5');
  await execute('repeatUntilFailure');
  assert.deepEqual(args().slice(-6), [
    '--repeat-each',
    '5',
    '--max-failures',
    '1',
    '--workers',
    '1',
  ]);
});
it('runShard', async () => {
  state.inputs.push('2/3');
  await execute('runShard');
  assert.deepEqual(args().slice(-2), ['--shard', '2/3']);
});
it('copyCICommand keeps shard index variable literal', async () => {
  state.inputs.push('4');
  await execute('copyCICommand');
  assert.match(state.clipboard, /\$\{SHARD_INDEX\}\/4/);
});
it('updateSnapshots', async () => {
  state.picks.push('missing');
  await execute('updateSnapshots');
  assert.deepEqual(args().slice(-2), ['--update-snapshots', 'missing']);
});
it('agent initialization and planner/generator/healer handoffs', async () => {
  state.files = ['planner', 'generator', 'healer'].map((name) =>
    Uri.file(path.join(root, '.github/agents', `${name}.agent.md`)),
  );
  await execute('initializeAgents');
  assert.ok(args().includes('init-agents'));
  state.inputs.push('http://localhost:3000', 'Checkout');
  await execute('generateTestPlan');
  state.picks.push(0);
  await execute('generateTestsFromPlan');
  await execute('healFailures');
  assert.equal(state.calls.filter((call) => call[0] === 'workbench.action.chat.open').length, 3);
});
it('component gallery opens configured URL', async () => {
  state.picks.push(0);
  await execute('openComponentGallery');
  assert.ok(state.calls.some((call) => call[0] === 'external'));
});
for (const [name, effect] of [
  ['importCoverage', 'coverage'],
  ['showAnalytics', 'analytics'],
  ['openWorkspaceDashboard', 'analytics'],
  ['openArtifact', 'artifact'],
])
  it(name, async () => {
    await execute(name, name === 'openArtifact' ? { spec } : Uri.file(file));
    assert.ok(calls.includes(effect));
  });
it('artifact command palette invocation does not crash', async () => {
  await execute('openArtifact');
  assert.match(state.documents[0].getText(), /unavailable/);
});
it('reviewSnapshots opens selected result', async () => {
  state.picks.push(0);
  await execute('reviewSnapshots');
  assert.ok(calls.includes('artifact'));
});
it('compareRuns and exportHistory create Markdown', async () => {
  state.picks.push((items: any[]) => items);
  await execute('compareRuns');
  await execute('exportHistory');
  assert.match(state.documents[0].getText(), /Run comparison/);
  assert.match(state.documents[1].getText(), /run history/);
});
for (const format of [
  'Save Markdown',
  'Save JUnit XML',
  'Save JSON',
  'Copy Markdown',
  'Copy GitHub comment',
])
  it(`exportResults ${format}`, async () => {
    state.picks.push(format);
    state.save = Uri.file(path.join(root, 'export.txt'));
    await execute('exportResults');
    if (format === 'Save JUnit XML') {
      const xml = fs.readFileSync(state.save.fsPath, 'utf8');
      assert.match(xml, /&lt;bad &amp; wrong&gt;/);
    }
    if (format === 'Save JSON')
      assert.equal(
        JSON.parse(fs.readFileSync(state.save.fsPath, 'utf8')).specs[0].title,
        spec.title,
      );
    if (format.startsWith('Copy')) assert.match(state.clipboard, /case \[1\]/);
  });
it('GitHub posting only executes after confirmation (task execution mocked)', async () => {
  state.inputs.push('123');
  await execute('postGitHubComment');
  assert.equal(state.tasks.length, 0);
  state.inputs.push('123');
  state.messages.push('Post Comment');
  await execute('postGitHubComment');
  assert.deepEqual(args().slice(0, 3), ['issue', 'comment', '123']);
  assert.equal(fs.readFileSync(args().at(-1)!, 'utf8').includes('case [1]'), true);
});
it('clearHistory requires confirmation', async () => {
  await execute('clearHistory');
  assert.deepEqual(calls, []);
  state.picks.push(1);
  await execute('clearHistory');
  assert.deepEqual(calls, ['clear']);
});
it('selectEnvFile persists a path relative to workingDirectory', async () => {
  state.settings.workingDirectory = 'e2e';
  state.files = [Uri.file(path.join(root, '.env.stage'))];
  state.picks.push(1);
  await execute('selectEnvFile');
  assert.equal(state.settings.envFile, path.join('..', '.env.stage'));
});
it('quarantine and unquarantine round-trip a test', async () => {
  await execute('quarantineTest');
  assert.match(window.activeTextEditor.document.getText(), /^test\.fixme/);
  await execute('unquarantineTest');
  assert.match(window.activeTextEditor.document.getText(), /^test\(/);
});
it('saveAsSnippet escapes dollar signs and writes profile-local snippets', async () => {
  state.inputs.push('p-custom', 'Custom');
  await execute('saveAsSnippet');
  const saved = JSON.parse(
    fs.readFileSync(path.join(root, 'User/snippets/playwright-custom.code-snippets'), 'utf8'),
  );
  assert.equal(saved.Custom.prefix, 'p-custom');
});
it('Cancel All Runs does not stop unrelated debug sessions', async () => {
  await execute('cancelRuns');
  assert.ok(!state.calls.some((call) => call[0] === 'stopDebug'));
});
it('fast debug termination cannot strand the wait', async () => {
  assert.equal(
    await debugCommandAndWait(
      { executable: 'node', args: [] },
      {
        resource: file,
        token: {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose() {} }),
        } as any,
      },
    ),
    true,
  );
});
it('project graph and health check consume local CLI diagnostics', async () => {
  const cli = path.join(root, 'mock-cli.js');
  fs.writeFileSync(
    cli,
    'console.log(JSON.stringify({ config: { projects: [{ name: "setup", dependencies: [] }, { name: "webkit", dependencies: ["setup"] }] } }));',
  );
  state.settings.testCommand = `node "${cli}"`;
  state.settings.toolCommand = `node "${cli}"`;
  await execute('showProjectGraph');
  assert.match(state.documents[0].getText(), /p0 --> p1/);
  await execute('healthCheck');
  assert.match(state.documents[1].getText(), /health check/i);
});

it('Intelligence dashboard exposes all workflows', async () => {
  await execute('openIntelligence');
  const html = state.panels.at(-1).webview.html;
  for (const label of [
    'Failure Detective',
    'Test the Tests',
    'Scenario Lab',
    'Living Behavior Map',
    'Change Radar',
    'Verified Repair',
    'Human &amp; Agent Journeys',
    'Product Promises',
  ])
    assert.ok(html.includes(label), label);
});
it('failure investigation groups failures and escapes untrusted evidence', async () => {
  await execute('investigateFailures');
  const html = state.panels.at(-1).webview.html;
  assert.match(html, /&lt;bad &amp; wrong&gt;/);
  assert.ok(!html.includes('<bad & wrong>'));
  assert.match(html, /Suggested experiment/);
});
it('mutation discovery explains when no application mutation is available', async () => {
  await execute('testTheTests');
  assert.match(state.panels.at(-1).webview.html, /application source file/);
});
it('scenario lab saves a validated scenario through its form handler', async () => {
  await execute('openScenarioLab');
  const panel = state.panels.at(-1);
  assert.match(panel.webview.html, /Create a scenario/);
  await panel.receive({
    action: 'saveScenario',
    value: {
      id: 'slow',
      name: 'Slow API',
      urlPattern: '**\/api/**',
      latencyMs: 500,
      offline: false,
    },
  });
  assert.equal(
    JSON.parse(
      fs.readFileSync(new IntelligenceStorage(root, context.storageUri.fsPath).configPath, 'utf8'),
    ).scenarios[0].latencyMs,
    500,
  );
  assert.match(panel.webview.html, /Slow API/);
});
it('behavior map extracts test routes and assertions', async () => {
  const mapped = path.join(root, 'mapped.spec.ts');
  fs.writeFileSync(
    mapped,
    "test('mapped', async ({page}) => { await page.goto('/checkout'); await expect(page.getByRole('button')).toBeVisible(); });",
  );
  try {
    await execute('showBehaviorMap');
    const html = state.panels.at(-1).webview.html;
    assert.match(html, /checkout/);
    assert.match(html, /mapped/);
  } finally {
    fs.unlinkSync(mapped);
  }
});
it('change radar supports cancelling the budget prompt without running tests', async () => {
  await execute('showChangeRadar');
  assert.equal(state.tasks.length, 0);
});
it('repair verification supports cancelling candidate selection without editing', async () => {
  const before = fs.readFileSync(file, 'utf8');
  await execute('verifyRepair');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(state.tasks.length, 0);
});
it('journey benchmark explains the executable adapter contract', async () => {
  await execute('benchmarkJourneys');
  assert.match(state.panels.at(-1).webview.html, /PLAYWRIGHT_STUDIO_JOURNEY/);
});
it('promise view shows revision-specific evidence requirements', async () => {
  await execute('managePromises');
  assert.match(state.panels.at(-1).webview.html, /source fingerprint/);
});

for (const [id, content] of [
  ['openBugCapsules', 'Capture failure'],
  ['branchFailure', 'Export checkpoint fixture'],
  ['checkProductLaws', 'Add law and adapter'],
  ['openAgentWindTunnel', 'studio-agent-metrics'],
  ['openIncidentMemory', 'Validate regression'],
])
  it(`${id} exposes its workflow controls`, async () => {
    await execute(id);
    assert.ok(state.panels.at(-1).webview.html.includes(content));
  });
it('challengeRepair cancellation preserves the original test', async () => {
  const before = fs.readFileSync(file, 'utf8');
  await execute('challengeRepair');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(state.tasks.length, 0);
});
it('showBehaviorDiff cancellation does not execute a checkout or test', async () => {
  await execute('showBehaviorDiff');
  assert.equal(state.tasks.length, 0);
});
it('sidebar commands refresh discovery and preserve the selected test for run/debug', async () => {
  await execute('refreshTests');
  assert.ok(calls.includes('refreshTests'));
  const item = { id: 'selected-test' };
  await execute('runExplorerTests', item);
  await execute('debugExplorerTests', item);
  await execute('runExplorerTests');
  assert.deepEqual(
    state.calls.filter((c) => c[0] === 'sidebarRun'),
    [
      ['sidebarRun', item, 'run'],
      ['sidebarRun', item, 'debug'],
      ['sidebarRun', undefined, 'run'],
    ],
  );
});
it('feature catalog opens the packaged guide without starting any test or external tool', async () => {
  await execute('openFeatureCatalog');
  const preview = state.calls.find((c) => c[0] === 'markdown.showPreview');
  assert.equal(preview?.[1].fsPath, path.join(context.extensionUri.fsPath, 'docs/features.md'));
  assert.ok(fs.existsSync(preview[1].fsPath));
  assert.equal(state.tasks.length, 0);
  assert.equal(state.debug.length, 0);
});
it('Selector Intelligence opens an isolated in-editor browser panel without launching a website', async () => {
  await execute('openSelectorIntelligence');
  assert.equal(state.panels.at(-1).title, 'Selector Intelligence');
  assert.match(state.panels.at(-1).webview.html, /Open website/);
  assert.deepEqual(state.panels.at(-1).options.localResourceRoots, []);
});
it('Inspect Tests routes the selection to Playwright Inspector', async () => {
  const item = { id: 'selected-test' };
  await execute('inspectExplorerTests', item);
  assert.deepEqual(
    state.calls.find((call) => call[0] === 'sidebarRun'),
    ['sidebarRun', item, 'inspect'],
  );
});
it('every published command has a behavioral command test', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
  );
  assert.deepEqual(
    manifest.contributes.commands
      .map((entry: any) => entry.command)
      .filter((id: string) => !exercised.has(id)),
    [],
  );
});

it('task end without a process event settles the waiter', async () => {
  state.processEvent = false;
  assert.equal(
    await runCommandAndWait({ executable: 'node', args: [] }, { resource: file }),
    undefined,
  );
});
for (const timing of ['during launch', 'before process startup', 'after process startup']) {
  it(`task cancellation ${timing} terminates the started process and never reports success`, async (t) => {
    const source = new CancellationTokenSource();
    const start = new EventEmitter<any>();
    const end = new EventEmitter<any>();
    const taskEnd = new EventEmitter<any>();
    t.mock.method(tasks, 'onDidStartTaskProcess', start.event);
    t.mock.method(tasks, 'onDidEndTaskProcess', end.event);
    t.mock.method(tasks, 'onDidEndTask', taskEnd.event);
    let execution: any;
    let terminations = 0;
    t.mock.method(tasks, 'executeTask', async (task: Task) => {
      execution = {
        task,
        terminate: () => {
          terminations++;
          // Some hosts report zero when a task is terminated. It is still cancelled.
          end.fire({ execution, exitCode: 0 });
          taskEnd.fire({ execution });
        },
      };
      if (timing === 'during launch') {
        source.cancel();
        assert.equal(terminations, 0);
        start.fire({ execution, processId: 1 });
      }
      return execution;
    });
    try {
      const completed = runCommandAndWait(
        { executable: 'node', args: [] },
        { resource: file, token: source.token },
      );
      await Promise.resolve();
      if (timing !== 'during launch') {
        if (timing === 'before process startup') source.cancel();
        assert.equal(terminations, 0, 'Do not terminate a task whose process is not ready.');
        start.fire({ execution, processId: 1 });
        if (timing === 'after process startup') source.cancel();
      }
      assert.equal(terminations, 1);
      assert.equal(await completed, undefined);
      source.cancel();
      assert.equal(terminations, 1, 'Completion removes the cancellation listener.');
      assert.equal(start.listeners.size + end.listeners.size + taskEnd.listeners.size, 0);
    } finally {
      source.dispose();
    }
  });
}
it('default capture adds JSON without overriding user reporters or editing config', async () => {
  state.settings.reporter = '';
  const before = fs.readFileSync(configFile, 'utf8');
  await execute('runFile', file);
  assert.equal(args().includes('--reporter'), false);
  assert.ok(state.tasks[0].execution.options.env.PW_TEST_REPORTER.endsWith('captureReporter.js'));
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});
it('capture can be disabled', async () => {
  state.settings.captureResults = false;
  state.settings.reporter = '';
  await execute('runFile', file);
  assert.equal(state.tasks[0].execution.options.env.PW_TEST_REPORTER, undefined);
});
