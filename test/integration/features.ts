import { coverageApi, hasNativeCoverage, FileCoverageDetail } from '../../src/vscodeCompatibility';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseEnvFile, loadConfiguredEnvFile } from '../../src/envFile';
import { parseCoverageJson } from '../../src/coverageImporter';
import {
  legacyLocatorReplacement,
  semanticLocatorReplacement,
  LocatorAssistant,
} from '../../src/locatorAssistant';
import { PlaywrightTestExplorer } from '../../src/testExplorer';
import { TestResultsViewProvider } from '../../src/testResultsView';
import { HistoryViewProvider, analyticsMarkdown, historyMarkdown } from '../../src/historyView';
import { AnnotationsViewProvider } from '../../src/annotationsView';
import { ComponentViewProvider } from '../../src/componentView';
import { ArtifactViewer } from '../../src/artifactViewer';
import { AnalyticsViewer } from '../../src/analyticsViewer';
import { ResultStore, SpecResult, TestResults } from '../../src/resultStore';
import { buildRunCommand, buildWorkspaceRunCommand, buildToolCommand } from '../../src/config';
import { runCommandAndWait, debugCommandAndWait, getExecutionEnv } from '../../src/terminal';
import { PlaywrightCodeLensProvider } from '../../src/codeLensProvider';
import { FixtureNavigationProvider } from '../../src/fixtureNavigation';
import { IntelligencePanel, features } from '../../src/intelligence/panel';
import { FeaturesViewProvider, featureGroups } from '../../src/featuresView';

export async function featureChecks(folder: vscode.WorkspaceFolder): Promise<void> {
  const failures: string[] = [];
  let passed = 0;
  const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}`, error);
    }
  };
  const first = vscode.Uri.joinPath(folder.uri, 'tests', 'first.spec.ts');
  const config = vscode.workspace.getConfiguration('playwrightSnippets', first);
  await check('all contributed commands are registered', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../..', 'package.json'), 'utf8'),
    );
    const registered = new Set(await vscode.commands.getCommands());
    for (const entry of manifest.contributes.commands)
      assert.ok(registered.has(entry.command), entry.command);
    const container = manifest.contributes.viewsContainers.activitybar.find(
      (c: any) => c.id === 'playwrightStudio',
    );
    assert.equal(container.title, 'Playwright Studio');
    assert.ok(fs.existsSync(path.resolve(__dirname, '../..', container.icon)));
    assert.deepEqual(
      manifest.contributes.views.playwrightStudio.map((v: any) => v.name),
      ['Tests', 'Results', 'History', 'Components', 'Annotations', 'Features'],
    );
    assert.ok(
      !manifest.contributes.views.explorer?.some((v: any) => v.id.startsWith('playwrightStudio.')),
    );
  });
  await check('Intelligence dashboard renders all workflows in a native webview', async () => {
    const panel = new IntelligencePanel(async () => {});
    try {
      panel.show(folder.uri.fsPath);
      const html = (panel as any).panel.webview.html as string;
      for (const [action] of features) assert.ok(html.includes(`data-action="${action}"`));
      assert.match(html, /Content-Security-Policy/);
      panel.show(folder.uri.fsPath, {
        title: 'Scenario Lab',
        introduction: 'Test conditions',
        sections: [],
      });
      assert.match((panel as any).panel.webview.html, /id="scenario"/);
    } finally {
      panel.dispose();
    }
  });
  await check('dotenv quoted values, inline comments, multiline and literal backslashes', () => {
    assert.deepEqual(
      parseEnvFile(
        'export BASE=hello # comment\nQUOTED="a#b" # comment\nSINGLE=\'C:\\new\'\nDOUBLE="a\\nb"\nMULTI="one\ntwo"\nEMPTY=\nBAD-KEY=x',
      ),
      {
        BASE: 'hello',
        QUOTED: 'a#b',
        SINGLE: 'C:\\new',
        DOUBLE: 'a\nb',
        MULTI: 'one\ntwo',
        EMPTY: '',
      },
    );
  });
  await check('missing configured env file reports an error', async () => {
    await config.update('envFile', '.missing-env-file', vscode.ConfigurationTarget.WorkspaceFolder);
    try {
      assert.throws(() => loadConfiguredEnvFile(first.fsPath), /Cannot read/);
    } finally {
      await config.update('envFile', '', vscode.ConfigurationTarget.WorkspaceFolder);
    }
  });
  await check('environment file path resolves against the working directory', async () => {
    fs.writeFileSync(path.join(folder.uri.fsPath, '.env.integration'), 'STUDIO_TEST_ENV=from-file');
    await config.update('envFile', '.env.integration', vscode.ConfigurationTarget.WorkspaceFolder);
    await config.update(
      'env',
      { STUDIO_TEST_ENV: 'from-settings' },
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      assert.equal(loadConfiguredEnvFile(first.fsPath).STUDIO_TEST_ENV, 'from-file');
      assert.equal(getExecutionEnv(first).STUDIO_TEST_ENV, 'from-settings');
      assert.equal(
        getExecutionEnv(first, { STUDIO_TEST_ENV: 'override' }).STUDIO_TEST_ENV,
        'override',
      );
    } finally {
      await config.update('envFile', '', vscode.ConfigurationTarget.WorkspaceFolder);
      await config.update('env', {}, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  });
  await check('file commands escape regex metacharacters and carry line and reporter', () => {
    const invocation = buildRunCommand(path.join(folder.uri.fsPath, 'tests', 'a [1].spec.ts'), {
      line: 2,
    });
    assert.ok(invocation.args.some((arg) => arg.endsWith('a \\[1\\]\\.spec\\.ts$:3')));
    assert.deepEqual(invocation.args.slice(-2), ['--reporter', 'list,json']);
    assert.deepEqual(buildToolCommand('show-trace', ['a b.zip'], first).args, [
      'mock-tool.js',
      'show-trace',
      'a b.zip',
    ]);
    assert.ok(!buildWorkspaceRunCommand(first).args.some((arg) => /:3$/.test(arg)));
  });
  if (hasNativeCoverage) {
    await check(
      'Istanbul multiline ranges preserve ending column and branch/function counts',
      () => {
        const files = parseCoverageJson(
          JSON.stringify({
            'app.js': {
              statementMap: { 0: { start: { line: 1, column: 12 }, end: { line: 3, column: 2 } } },
              s: { 0: 3 },
              fnMap: {
                0: {
                  name: 'main',
                  decl: { start: { line: 1, column: 12 }, end: { line: 1, column: 16 } },
                },
              },
              f: { 0: 2 },
              branchMap: {
                0: { locations: [{ start: { line: 2, column: 0 }, end: { line: 2, column: 1 } }] },
              },
              b: { 0: [0] },
            },
          }),
          folder.uri.fsPath,
        );
        const statement = files[0].details[0] as FileCoverageDetail;
        assert.equal((statement.location as vscode.Range).end.character, 2);
        assert.equal(statement.executed, 3);
        assert.equal(statement.branches![0].executed, 0);
        assert.equal((files[0].details[1] as FileCoverageDetail).executed, 2);
      },
    );
    await check('V8 single-range functions include statement coverage', () => {
      const source = path.join(folder.uri.fsPath, 'app.js');
      const files = parseCoverageJson(
        JSON.stringify({
          result: [
            {
              url: vscode.Uri.file(source).toString(),
              functions: [
                { functionName: 'main', ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] },
              ],
            },
          ],
        }),
        folder.uri.fsPath,
      );
      assert.ok(files[0].details.some((detail) => detail instanceof coverageApi.StatementCoverage));
      assert.ok(
        files[0].details.some((detail) => detail instanceof coverageApi.DeclarationCoverage),
      );
    });
    await check('nested Istanbul statements count each branch once', () => {
      const outer = { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } };
      const inner = { start: { line: 2, column: 0 }, end: { line: 3, column: 0 } };
      const files = parseCoverageJson(
        JSON.stringify({
          'app.js': {
            statementMap: { 0: outer, 1: inner },
            s: { 0: 1, 1: 1 },
            branchMap: { 0: { locations: [inner] } },
            b: { 0: [1] },
          },
        }),
        folder.uri.fsPath,
      );
      assert.equal(
        files[0].details.reduce(
          (sum, detail) =>
            sum +
            (detail instanceof coverageApi.StatementCoverage ? (detail.branches?.length ?? 0) : 0),
          0,
        ),
        1,
      );
    });
  }
  await check('unsupported coverage is rejected', () => {
    for (const source of ['null', '{}', '[]', 'not json'])
      assert.throws(() => parseCoverageJson(source, folder.uri.fsPath));
  });
  await check('locator rewrites preserve escaped selectors and exact attributes', () => {
    const original = String.raw`page.click('text=it\'s ready')`;
    assert.equal(
      legacyLocatorReplacement(original),
      String.raw`page.locator('text=it\'s ready').click()`,
    );
    assert.equal(
      semanticLocatorReplacement(`page.locator('[placeholder="Email"]')`),
      'page.getByPlaceholder("Email", { exact: true })',
    );
    assert.equal(semanticLocatorReplacement(`page.locator('text=/Save/i')`), undefined);
    assert.equal(semanticLocatorReplacement('page.locator(`text=${label}`)'), undefined);
  });
  await check('locator diagnostics ignore quoted examples and comments', async () => {
    const assistant = new LocatorAssistant();
    const document = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: `const example = "page.locator('text=Save')";\n// page.click('button')\nawait page.locator('text=Real').click();`,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const diagnostics = (assistant as any).diagnostics
        .get(document.uri)
        .filter((d: vscode.Diagnostic) => d.code === 'semantic-locator');
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].range.start.line, 2);
    } finally {
      assistant.dispose();
    }
  });

  const changed = new vscode.EventEmitter<TestResults>();
  const historyChanged = new vscode.EventEmitter<readonly unknown[]>();
  const specs: SpecResult[] = [
    {
      title: 'case A',
      titlePath: ['suite', 'case A'],
      file: first.fsPath,
      line: 1,
      status: 'passed',
      duration: 2,
      projectName: 'chromium',
      tags: ['@smoke', '@smoke'],
      annotations: [{ type: '@smoke' }],
    },
    {
      title: 'case B',
      titlePath: ['suite', 'case B'],
      file: first.fsPath,
      line: 1,
      status: 'failed',
      duration: 4,
      projectName: 'webkit',
      error: 'failure',
      attachments: [{ name: 'trace', path: '/tmp/trace.zip' }],
    },
  ];
  const results: TestResults = {
    rootDir: folder.uri.fsPath,
    specs,
    summary: { passed: 1, failed: 1, skipped: 0, flaky: 0, duration: 6, startTime: new Date() },
  };
  let current: TestResults | null = results;
  const store = {
    onDidChange: changed.event,
    onDidHistoryChange: historyChanged.event,
    getResultsFor: () => current,
    get allResults() {
      return current ? [current] : [];
    },
    history: [{ ...results, id: 'one', workspaceRoot: folder.uri.fsPath, capturedAt: new Date() }],
  } as unknown as ResultStore;
  // Instantiate providers against the real VS Code API; a small in-memory store
  // lets tests control result arrival without depending on file watcher timing.
  const explorer = new PlaywrightTestExplorer(
    store,
    vscode.tests.createTestController('featureChecks', 'Feature checks'),
  );
  const internal = explorer as any;
  await explorer.refresh();
  const token = new vscode.CancellationTokenSource();
  await check('Test Explorer discovers files and runtime cases', () => {
    const root = explorer.controller.items.get(folder.uri.toString());
    assert.ok(root?.children.get(first.toString()));
    const runtime = root?.children.get(first.toString())?.children.get(`${first}:runtime`);
    assert.equal(runtime?.children.size, 2);
  });
  await check('Studio sidebar shares native tests, source navigation and result updates', () => {
    const root = explorer.getChildren().find((item) => item.id === folder.uri.toString())!;
    const file = explorer
      .getChildren(root)
      .find((item) => item.uri?.toString() === first.toString())!;
    assert.equal(explorer.getParent(file), root);
    const row = explorer.getTreeItem(file);
    assert.equal(row.id, file.id);
    assert.equal(row.contextValue, 'playwrightStudioTest');
    assert.equal(row.command?.command, 'vscode.open');
    assert.equal((row.command?.arguments?.[0] as vscode.Uri).toString(), first.toString());
    assert.ok(String(row.description).includes('failed'));
    let updates = 0;
    const subscription = explorer.onDidChangeTreeData(() => updates++);
    try {
      changed.fire(results);
      assert.ok(updates > 0);
    } finally {
      subscription.dispose();
    }
  });
  await check(
    'Studio sidebar run, debug and inspect route through the native runner with the selected node',
    async () => {
      const root = explorer.getChildren().find((item) => item.id === folder.uri.toString())!;
      const file = explorer
        .getChildren(root)
        .find((item) => item.uri?.toString() === first.toString())!;
      const original = internal.run;
      const requests: { request: vscode.TestRunRequest; debug: boolean; inspect: boolean }[] = [];
      internal.run = async (
        request: vscode.TestRunRequest,
        _token: vscode.CancellationToken,
        debug: boolean,
        inspect: boolean,
      ) => {
        requests.push({ request, debug, inspect });
      };
      try {
        await explorer.runFromSidebar(file);
        await explorer.runFromSidebar(file, 'debug');
        await explorer.runFromSidebar(file, 'inspect');
        await explorer.runFromSidebar();
        assert.equal(requests[0].request.include?.[0], file);
        assert.equal(requests[0].debug, false);
        assert.equal(requests[1].debug, true);
        assert.equal(requests[2].inspect, true);
        assert.equal(requests[2].debug, false);
        assert.equal(requests[2].request.include?.[0], file);
        assert.equal(requests[3].request.include, undefined);
      } finally {
        internal.run = original;
      }
    },
  );
  await check('same-line nested suites retain their children', async () => {
    const uri = vscode.Uri.joinPath(folder.uri, 'tests', 'nested.spec.ts');
    fs.writeFileSync(
      uri.fsPath,
      "test.describe('outer', () => { test.describe('inner', () => { test('nested', () => {}); }); });",
    );
    await internal.refreshFile(uri);
    const root = explorer.controller.items.get(folder.uri.toString())!;
    const item = root.children.get(uri.toString())!;
    const children = (parent: vscode.TestItem) => {
      const values: vscode.TestItem[] = [];
      parent.children.forEach((child) => values.push(child));
      return values;
    };
    assert.equal(children(item)[0].label, 'outer');
    assert.equal(children(children(item)[0])[0].label, 'inner');
    assert.equal(children(children(children(item)[0])[0])[0].label, 'nested');
  });
  await check('already-arrived results are consumed immediately', async () => {
    const start = Date.now();
    assert.equal(await internal.waitForFreshResults(null, first.fsPath, token.token), true);
    assert.ok(Date.now() - start < 500);
  });
  await check('parameterized results match title and project', () => {
    const result = internal.matchingResult({
      file: first.fsPath,
      line: 1,
      name: 'case A',
      projectName: 'chromium',
      runtime: true,
      kind: 'test',
    });
    assert.equal(result.status, 'passed');
  });
  await check('runtime suite aggregates child outcomes', () => {
    assert.equal(internal.matchingResult({ file: first.fsPath, kind: 'suite' }).status, 'failed');
  });
  await check('deleting a discovered file clears stale targets', () => {
    internal.removeFile(first);
    assert.ok(
      ![...internal.targets.keys()].some(
        (id: string) => id === first.toString() || id.startsWith(`${first}:`),
      ),
    );
  });
  await explorer.refresh();
  await check('Test Explorer reflects unsaved edits', async () => {
    const document = await vscode.workspace.openTextDocument(first);
    const edit = new vscode.WorkspaceEdit();
    const position = document.positionAt(document.getText().length);
    edit.insert(first, position, `\ntest('unsaved discovery', async () => {});\n`);
    await vscode.workspace.applyEdit(edit);
    await internal.refreshFile(first);
    assert.ok(
      [...internal.targets.values()].some((target: any) => target.name === 'unsaved discovery'),
    );
  });
  await check('cancelled tasks do not launch', async () => {
    const cancelled = new vscode.CancellationTokenSource();
    cancelled.cancel();
    try {
      assert.equal(
        await runCommandAndWait(
          { executable: 'definitely-do-not-execute', args: [] },
          { resource: first, token: cancelled.token },
        ),
        undefined,
      );
    } finally {
      cancelled.dispose();
    }
  });
  await check('cancelled debug runs do not launch', async () => {
    const cancelled = new vscode.CancellationTokenSource();
    cancelled.cancel();
    try {
      assert.equal(
        await debugCommandAndWait(
          { executable: 'definitely-do-not-execute', args: [] },
          { resource: first, token: cancelled.token },
        ),
        false,
      );
    } finally {
      cancelled.dispose();
    }
  });
  await check('task completion reports the exit code', async () => {
    const code = await runCommandAndWait(
      { executable: 'node', args: ['-e', 'process.exit(7)'] },
      { resource: first, token: token.token },
    );
    assert.equal(code, 7);
  });
  await check('running task cancellation settles the caller', async () => {
    const cancelled = new vscode.CancellationTokenSource();
    const name = 'Studio cancellation integration check';
    const completedFile = path.join(folder.uri.fsPath, 'cancelled-task-completed.txt');
    fs.rmSync(completedFile, { force: true });
    let started = false;
    const start = vscode.tasks.onDidStartTaskProcess((event) => {
      if (event.execution.task.name !== name) return;
      started = true;
      cancelled.cancel();
    });
    try {
      const result = await runCommandAndWait(
        {
          executable: 'node',
          args: [
            '-e',
            `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(completedFile)}, 'completed'), 30000)`,
          ],
        },
        { resource: first, token: cancelled.token, name },
      );
      assert.equal(started, true, 'The check must cancel a started process.');
      assert.equal(result, undefined, 'Cancellation must not report a successful exit.');
      assert.equal(fs.existsSync(completedFile), false, 'The process must not run to completion.');
    } finally {
      start.dispose();
      cancelled.dispose();
      fs.rmSync(completedFile, { force: true });
    }
  });
  await check('results sidebar initializes from existing results and exposes trace action', () => {
    const view = new TestResultsViewProvider(store);
    try {
      const roots = view.getChildren();
      assert.equal(roots.length, 1);
      const files = view.getChildren(roots[0]);
      assert.equal(files.length, 1);
      const tests = view.getChildren(files[0]);
      assert.equal(tests.length, 2);
      assert.ok(
        view
          .getChildren(tests[1])
          .some((node) => node.command?.command === 'playwrightSnippets.showTrace'),
      );
    } finally {
      view.dispose();
    }
  });
  await check('annotation groups do not double count duplicate tags', () => {
    const view = new AnnotationsViewProvider(store);
    try {
      assert.equal(view.getChildren(view.getChildren()[0]).length, 1);
    } finally {
      view.dispose();
    }
  });
  await check('history lists failures first and exports both cases', () => {
    const view = new HistoryViewProvider(store);
    try {
      const tests = view.getChildren(view.getChildren()[0]);
      assert.equal(tests[0].label, 'case B');
      assert.match(historyMarkdown(store), /case B/);
    } finally {
      view.dispose();
    }
  });
  await check('analytics keeps same-line parameterized cases separate', () => {
    const markdown = analyticsMarkdown(store);
    assert.match(markdown, /case A/);
    assert.match(markdown, /case B/);
    const viewer = new AnalyticsViewer(store);
    try {
      const html = (viewer as any).html({});
      assert.match(html, /case A/);
      assert.match(html, /case B/);
      assert.doesNotMatch(html, /style="height:/);
      const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)!;
      assert.doesNotThrow(() => new Function(script[1]));
    } finally {
      viewer.dispose();
    }
  });
  await check('artifact HTML escapes untrusted output and limits file actions', () => {
    const context = {
      globalStorageUri: folder.uri,
      storageUri: folder.uri,
    } as vscode.ExtensionContext;
    const viewer = new ArtifactViewer(context);
    try {
      const spec = {
        ...specs[0],
        title: '<script>bad()</script>',
        output: '<img onerror="bad()">',
        attachments: [
          {
            name: 'output',
            body: Buffer.from('<script>x</script>').toString('base64'),
            contentType: 'text/plain',
          },
        ],
      };
      const html = (viewer as any).html(
        { cspSource: 'test', asWebviewUri: (uri: vscode.Uri) => uri },
        spec,
      );
      assert.ok(!html.includes('<script>bad()'));
      assert.match(html, /&lt;script&gt;bad/);
      assert.match(html, /Content-Security-Policy/);
      assert.equal((viewer as any).safeArtifactPath('/tmp/unrelated'), undefined);
    } finally {
      viewer.dispose();
    }
  });
  await check('component gallery indexes exports but ignores examples', async () => {
    fs.writeFileSync(
      path.join(folder.uri.fsPath, 'Button.stories.ts'),
      `const example = 'export const Fake = {}';\n// export const Comment = {}\nexport default {};\nexport const Primary = {};\nconst local = {}; export { local as Secondary };`,
    );
    const view = new ComponentViewProvider();
    try {
      await view.refresh();
      const stories = view.getChildren(view.getChildren()[0]).map((item) => item.label);
      assert.deepEqual(stories, ['Primary', 'Secondary']);
    } finally {
      view.dispose();
    }
  });
  await check('fixture definition and hover navigate to workspace fixtures', async () => {
    fs.writeFileSync(
      path.join(folder.uri.fsPath, 'fixtures.ts'),
      `export const test = base.extend({ account: async ({}, use) => { await use('a'); } });`,
    );
    const uri = vscode.Uri.joinPath(folder.uri, 'tests', 'fixture.spec.ts');
    fs.writeFileSync(uri.fsPath, `test('fixture', async ({ account }) => {});`);
    const document = await vscode.workspace.openTextDocument(uri);
    const provider = new FixtureNavigationProvider();
    try {
      const position = document.positionAt(document.getText().indexOf('account') + 2);
      const definitions = await provider.provideDefinition(document, position);
      assert.ok(definitions.some((def) => def.uri.fsPath.endsWith('fixtures.ts')));
      assert.ok(await provider.provideHover(document, position));
    } finally {
      provider.dispose();
    }
  });
  await check('CodeLens offers run, debug, inspect, tags and projects', async () => {
    const document = await vscode.workspace.openTextDocument(first);
    const lenses = new PlaywrightCodeLensProvider().provideCodeLenses(document);
    for (const command of [
      'runFile',
      'debugFile',
      'inspectFile',
      'runTest',
      'debugTest',
      'inspectTest',
      'runWithTag',
      'runWithProject',
    ]) {
      assert.ok(
        lenses.some((lens) => lens.command?.command === `playwrightSnippets.${command}`),
        command,
      );
    }
  });
  await check(
    'Features sidebar covers all commands and opens anchored feature documentation',
    async () => {
      const provider = new FeaturesViewProvider();
      const manifest = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../..', 'package.json'), 'utf8'),
      );
      const entries = featureGroups.flatMap((group) => group.features);
      assert.deepEqual(
        entries
          .filter((entry) => entry.command)
          .map((entry) => entry.command)
          .sort(),
        manifest.contributes.commands.map((entry: any) => entry.command).sort(),
      );
      assert.equal(provider.getChildren().length, featureGroups.length);
      for (const group of featureGroups) {
        assert.equal(provider.getChildren(group).length, group.features.length);
        for (const feature of group.features) {
          const row = provider.getTreeItem(feature);
          assert.equal(provider.getParent(feature), group);
          assert.ok(String(row.tooltip).includes(feature.description));
          assert.equal(row.command?.command, 'playwrightSnippets.openFeatureCatalog');
          assert.deepEqual(row.command?.arguments, [feature.id]);
        }
      }
      await vscode.commands.executeCommand('playwrightStudio.featuresView.focus');
      await vscode.commands.executeCommand(
        'playwrightSnippets.openFeatureCatalog',
        'openBugCapsules',
      );
      // The built-in Markdown command returns before its webview tab reaches the host.
      await new Promise<void>((resolve, reject) => {
        const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
        const timer = setTimeout(() => {
          listener.dispose();
          reject(
            new Error(
              `Feature preview did not open. Tabs: ${tabs()
                .map((tab) => tab.label)
                .join(', ')}`,
            ),
          );
        }, 5000);
        const checkPreview = () => {
          if (tabs().some((tab) => tab.label.includes('features.md'))) {
            clearTimeout(timer);
            listener.dispose();
            resolve();
          }
        };
        const listener = vscode.window.tabGroups.onDidChangeTabs(checkPreview);
        checkPreview();
      });
    },
  );
  explorer.dispose();
  token.dispose();
  changed.dispose();
  historyChanged.dispose();
  console.log(`Feature checks: ${passed} passed, ${failures.length} failed`);
  assert.deepEqual(failures, [], 'Feature checks failed');
}
