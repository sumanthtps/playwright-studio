import * as path from 'path';
import * as vscode from 'vscode';
import {
  coverageApi,
  hasNativeCoverage,
  CompatibleProfile,
  FileCoverage,
  FileCoverageDetail,
} from './vscodeCompatibility';
import { buildRunCommand } from './config';
import { ResultStore, SpecResult, TestResults } from './resultStore';
import { parseTests } from './testParser';
import { debugCommandAndWait, runCommandAndWait } from './terminal';
import { parseCoverageJson } from './coverageImporter';
import { getConfig } from './config';
import { capturedTestPattern } from './commandLine';
import { readBoundedFile } from './fileSecurity';

interface TestTarget {
  file: string;
  line?: number;
  name?: string;
  projectName?: string;
  runtime?: boolean;
  titlePath?: string[];
  kind: 'folder' | 'file' | 'suite' | 'test';
}

const TEST_GLOB = '**/*.{spec,test}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';

export class PlaywrightTestExplorer
  implements vscode.Disposable, vscode.TreeDataProvider<vscode.TestItem>
{
  private readonly targets = new Map<string, TestTarget>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly coverageDetails = new WeakMap<FileCoverage, FileCoverageDetail[]>();
  private readonly coverageProfile: CompatibleProfile;
  private readonly treeChanged = new vscode.EventEmitter<vscode.TestItem | undefined>();
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;
  private refreshGeneration = 0;
  readonly onDidChangeTreeData = this.treeChanged.event;

  constructor(
    private readonly store: ResultStore,
    readonly controller = vscode.tests.createTestController(
      'playwrightStudio',
      'Playwright Studio',
    ),
  ) {
    this.controller.resolveHandler = (item) => (item ? this.refreshFile(item.uri) : this.refresh());
    const runProfile = this.controller.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.run(request, token, false),
      true,
    );
    if ('supportsContinuousRun' in runProfile)
      (runProfile as CompatibleProfile).supportsContinuousRun = true;
    this.controller.createRunProfile(
      'Debug',
      vscode.TestRunProfileKind.Debug,
      (request, token) => this.run(request, token, true),
      true,
    );
    this.coverageProfile = this.controller.createRunProfile(
      'Import Coverage',
      vscode.TestRunProfileKind.Coverage,
      (request, token) => this.importCoverage(undefined, request, token),
      true,
    );
    if (hasNativeCoverage)
      this.coverageProfile.loadDetailedCoverage = async (_run, coverage) =>
        this.coverageDetails.get(coverage) ?? [];

    const watcher = vscode.workspace.createFileSystemWatcher(TEST_GLOB);
    watcher.onDidCreate((uri) => this.scheduleRefresh(uri));
    watcher.onDidChange((uri) => this.scheduleRefresh(uri));
    watcher.onDidDelete((uri) => this.removeFile(uri));
    this.disposables.push(
      watcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh().catch((error) => this.reportError(error));
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleRefresh(event.document.uri)),
      store.onDidChange((results) => {
        for (const spec of results.specs) this.addRuntimeCase(spec);
        this.treeChanged.fire(undefined);
      }),
    );
    void this.refresh().catch((error) => this.reportError(error));
  }

  private reportError(error: unknown): void {
    if (!this.disposed)
      void vscode.window.showErrorMessage(
        `Playwright Studio: ${error instanceof Error ? error.message : String(error)}`,
      );
  }

  private scheduleRefresh(uri: vscode.Uri): void {
    if (this.disposed || !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(uri.fsPath)) return;
    const id = uri.toString();
    clearTimeout(this.refreshTimers.get(id));
    this.refreshTimers.set(
      id,
      setTimeout(() => {
        this.refreshTimers.delete(id);
        void this.refreshFile(uri).catch((error) => this.reportError(error));
      }, 150),
    );
  }

  getChildren(item?: vscode.TestItem): vscode.TestItem[] {
    const children: vscode.TestItem[] = [];
    (item?.children ?? this.controller.items).forEach((child) => {
      if (item || child.children.size > 0) children.push(child);
    });
    return children;
  }

  getParent(item: vscode.TestItem): vscode.TestItem | undefined {
    return item.parent;
  }

  getTreeItem(item: vscode.TestItem): vscode.TreeItem {
    const target = this.targets.get(item.id);
    const result = target ? this.matchingResult(target) : undefined;
    const node = new vscode.TreeItem(
      item.label,
      item.children.size
        ? target?.kind === 'folder'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    node.id = item.id;
    node.contextValue = 'playwrightStudioTest';
    node.resourceUri = item.uri;
    node.description = [
      item.description,
      result?.status,
      result ? `${result.duration}ms` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    node.tooltip = [item.label, target?.file, result?.error].filter(Boolean).join('\n');
    const icon =
      result?.status === 'failed' || result?.status === 'timedOut'
        ? 'error'
        : result?.status === 'passed'
          ? 'pass'
          : result?.status === 'flaky'
            ? 'warning'
            : result?.status === 'skipped'
              ? 'debug-step-over'
              : target?.kind === 'folder'
                ? 'root-folder'
                : target?.kind === 'file'
                  ? 'file-code'
                  : target?.kind === 'suite'
                    ? 'symbol-namespace'
                    : 'circle-outline';
    const color = result
      ? result.status === 'failed' || result.status === 'timedOut'
        ? 'testing.iconFailed'
        : result.status === 'passed'
          ? 'testing.iconPassed'
          : result.status === 'flaky'
            ? 'testing.iconFlaky'
            : 'testing.iconSkipped'
      : undefined;
    node.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    if (item.uri && target?.kind !== 'folder')
      node.command = {
        command: 'vscode.open',
        title: 'Go to Test',
        arguments: [item.uri, { selection: item.range }],
      };
    return node;
  }

  async runFromSidebar(
    item?: vscode.TestItem,
    mode: 'run' | 'debug' | 'inspect' = 'run',
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          mode === 'inspect'
            ? 'Inspect Playwright tests'
            : mode === 'debug'
              ? 'Debug Playwright tests'
              : 'Run Playwright tests',
        cancellable: true,
      },
      async (_progress, token) => {
        if (!this.controller.items.size) await this.refresh();
        if (token.isCancellationRequested) return;
        await this.run(
          new vscode.TestRunRequest(item ? [item] : undefined),
          token,
          mode === 'debug',
          mode === 'inspect',
        );
      },
    );
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.refreshGeneration;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const activeFolderIds = new Set(folders.map((folder) => folder.uri.toString()));
    this.controller.items.forEach((item) => {
      if (!activeFolderIds.has(item.id)) {
        this.controller.items.delete(item.id);
        for (const key of this.targets.keys()) {
          if (key === item.id || key.startsWith(`${item.id}/`)) this.targets.delete(key);
        }
      }
    });

    for (const folder of folders) {
      const id = folder.uri.toString();
      let root = this.controller.items.get(id);
      if (!root) {
        root = this.controller.createTestItem(id, folder.name, folder.uri);
        root.canResolveChildren = true;
        this.controller.items.add(root);
        this.targets.set(id, { file: folder.uri.fsPath, kind: 'folder' });
      }
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, TEST_GLOB),
        '**/{node_modules,.git,test-results,playwright-report}/**',
      );
      if (this.disposed || generation !== this.refreshGeneration) return;
      const fileIds = new Set(files.map((uri) => uri.toString()));
      root.children.forEach((item) => {
        if (!fileIds.has(item.id) && item.uri) this.removeFile(item.uri);
      });
      for (let index = 0; index < files.length; index += 50) {
        if (this.disposed || generation !== this.refreshGeneration) return;
        await Promise.all(files.slice(index, index + 50).map((uri) => this.refreshFile(uri)));
      }
    }
    this.treeChanged.fire(undefined);
  }

  private folderItem(uri: vscode.Uri): vscode.TestItem | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? this.controller.items.get(folder.uri.toString()) : undefined;
  }

  async importCoverage(
    source?: vscode.Uri,
    request?: vscode.TestRunRequest,
    token?: vscode.CancellationToken,
  ): Promise<void> {
    if (!hasNativeCoverage) {
      void vscode.window.showInformationMessage(
        'Native test coverage requires a newer VS Code version. Update VS Code to import coverage.',
      );
      return;
    }
    const selected = source
      ? [source]
      : await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'Istanbul / V8 coverage': ['json'] },
          title: 'Import coverage into VS Code Test Coverage',
        });
    if (!selected?.[0] || token?.isCancellationRequested) return;
    const baseDir = getConfig(selected[0]).workingDirectory;
    const files = parseCoverageJson(
      readBoundedFile(selected[0].fsPath, 64 * 1024 * 1024).toString('utf8'),
      baseDir,
    );
    const coverageRequest =
      request ?? new vscode.TestRunRequest(undefined, undefined, this.coverageProfile);
    const run = this.controller.createTestRun(
      coverageRequest,
      `Coverage: ${path.basename(selected[0].fsPath)}`,
    );
    try {
      for (const file of files) {
        if (token?.isCancellationRequested) break;
        const coverage = coverageApi.FileCoverage!.fromDetails(file.uri, file.details);
        this.coverageDetails.set(coverage, file.details);
        (run as vscode.TestRun & { addCoverage(coverage: FileCoverage): void }).addCoverage(
          coverage,
        );
      }
      run.appendOutput(`Imported coverage for ${files.length} files.\r\n`);
    } finally {
      run.end();
    }
  }

  private async refreshFile(uri: vscode.Uri | undefined): Promise<void> {
    if (
      this.disposed ||
      !uri ||
      uri.scheme !== 'file' ||
      !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(uri.fsPath)
    )
      return;
    if (
      /(?:^|[\\/])(?:node_modules|\.git|test-results|playwright-report)(?:[\\/]|$)/.test(uri.fsPath)
    )
      return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    let root = this.folderItem(uri);
    if (!root) {
      await this.refresh();
      if (this.disposed) return;
      root = this.folderItem(uri);
      if (!root) return;
    }

    let source: string;
    try {
      source =
        vscode.workspace.textDocuments
          .find((document) => document.uri.toString() === uri.toString())
          ?.getText() ?? readBoundedFile(uri.fsPath, 4 * 1024 * 1024).toString('utf8');
    } catch {
      this.removeFile(uri);
      return;
    }
    if (Buffer.byteLength(source) > 4 * 1024 * 1024) {
      this.removeFile(uri);
      return;
    }
    const lines = source.split(/\r?\n/);
    const parsed = parseTests({ getText: () => source } as vscode.TextDocument);
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    const id = uri.toString();
    for (const key of [...this.targets.keys()]) {
      if (key.startsWith(`${id}:`)) this.targets.delete(key);
    }
    const fileItem = this.controller.createTestItem(id, relative, uri);
    fileItem.range = new vscode.Range(0, 0, Math.max(0, lines.length - 1), 0);
    this.targets.set(id, { file: uri.fsPath, kind: 'file' });

    // Parser output is in source order; a stack avoids scanning/sorting every suite
    // again for every test while retaining nested suites on the same line.
    const parents: { endOffset: number; item: vscode.TestItem }[] = [];
    for (const entry of parsed) {
      while (parents.length && parents[parents.length - 1].endOffset < entry.endOffset)
        parents.pop();
      const kind = entry.kind === 'describe' ? 'suite' : 'test';
      const itemId = `${id}:${kind}:${entry.startOffset}:${entry.name}`;
      const item = this.controller.createTestItem(itemId, entry.name, uri);
      item.range = new vscode.Range(entry.line, 0, entry.line, lines[entry.line]?.length ?? 0);
      if (kind === 'test') item.tags = entry.tags.map((tag) => new vscode.TestTag(tag));
      (parents[parents.length - 1]?.item.children ?? fileItem.children).add(item);
      this.targets.set(itemId, { file: uri.fsPath, line: entry.line, name: entry.name, kind });
      if (kind === 'suite') parents.push({ endOffset: entry.endOffset, item });
    }
    root.children.add(fileItem);
    for (const spec of this.store.getResultsFor(uri)?.specs ?? []) {
      if (path.normalize(spec.file) === path.normalize(uri.fsPath)) this.addRuntimeCase(spec);
    }
    this.treeChanged.fire(undefined);
  }

  private removeFile(uri: vscode.Uri): void {
    clearTimeout(this.refreshTimers.get(uri.toString()));
    this.refreshTimers.delete(uri.toString());
    this.folderItem(uri)?.children.delete(uri.toString());
    for (const key of this.targets.keys()) {
      if (key === uri.toString() || key.startsWith(`${uri.toString()}:`)) this.targets.delete(key);
    }
    this.treeChanged.fire(undefined);
  }

  private addRuntimeCase(spec: SpecResult): void {
    const uri = vscode.Uri.file(spec.file);
    const fileItem = this.folderItem(uri)?.children.get(uri.toString());
    if (!fileItem) return;
    const matchingStatic = [...this.targets.entries()].some(
      ([id, target]) =>
        id.startsWith(`${uri.toString()}:test:`) &&
        target.line === spec.line &&
        target.name === spec.title,
    );
    if (matchingStatic) return;
    const suiteId = `${uri.toString()}:runtime`;
    let suite = fileItem.children.get(suiteId);
    if (!suite) {
      suite = this.controller.createTestItem(suiteId, 'Runtime / parameterized cases', uri);
      fileItem.children.add(suite);
      this.targets.set(suiteId, { file: spec.file, kind: 'suite' });
    }
    const id = `${suiteId}:${spec.line}:${spec.projectName ?? ''}:${spec.title}`;
    const item = this.controller.createTestItem(id, spec.title, uri);
    item.range = new vscode.Range(spec.line, 0, spec.line, 0);
    item.description = spec.projectName;
    item.tags = [
      ...(spec.tags ?? []).map((tag) => new vscode.TestTag(tag)),
      ...(spec.annotations ?? []).map((annotation) => new vscode.TestTag(annotation.type)),
    ];
    suite.children.add(item);
    this.targets.set(id, {
      file: spec.file,
      line: spec.line,
      name: spec.title,
      projectName: spec.projectName,
      titlePath: spec.titlePath,
      runtime: true,
      kind: 'test',
    });
  }

  private collect(item: vscode.TestItem, output: vscode.TestItem[], atomicContainers = true): void {
    const target = this.targets.get(item.id);
    if (
      target?.kind === 'test' ||
      (atomicContainers && (target?.kind === 'file' || target?.kind === 'suite'))
    ) {
      output.push(item);
      return;
    }
    item.children.forEach((child) => this.collect(child, output, atomicContainers));
  }

  private requestedItems(request: vscode.TestRunRequest): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    const roots = request.include
      ? [...request.include]
      : (() => {
          const values: vscode.TestItem[] = [];
          this.controller.items.forEach((item) => values.push(item));
          return values;
        })();
    const atomicContainers = !request.exclude?.length;
    for (const root of roots) this.collect(root, items, atomicContainers);
    const excluded = new Set<string>();
    for (const item of request.exclude ?? []) {
      const descendants: vscode.TestItem[] = [];
      this.collect(item, descendants, false);
      for (const descendant of descendants) excluded.add(descendant.id);
    }
    return [
      ...new Map(
        items.filter((item) => !excluded.has(item.id)).map((item) => [item.id, item]),
      ).values(),
    ];
  }

  private matchingResult(target: TestTarget): SpecResult | undefined {
    const candidates =
      this.store
        .getResultsFor(target.file)
        ?.specs.filter(
          (spec) =>
            path.normalize(spec.file) === path.normalize(target.file) &&
            (target.projectName === undefined || target.projectName === spec.projectName) &&
            (!target.runtime || target.name === spec.title) &&
            (target.kind === 'suite' && target.name
              ? spec.titlePath?.includes(target.name)
              : target.line === undefined || spec.line === target.line),
        ) ?? [];
    const severity = (spec: SpecResult) =>
      spec.status === 'failed' || spec.status === 'timedOut'
        ? 4
        : spec.status === 'flaky'
          ? 3
          : spec.status === 'passed'
            ? 2
            : 1;
    return candidates.sort((left, right) => severity(right) - severity(left))[0];
  }

  private applyResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    exitCode?: number,
    useCapturedResult = true,
  ): void {
    const target = this.targets.get(item.id);
    const result = useCapturedResult && target ? this.matchingResult(target) : undefined;
    if (useCapturedResult && target && this.store.getResultsFor(target.file)?.errors?.length) {
      run.errored(
        item,
        new vscode.TestMessage(this.store.getResultsFor(target.file)!.errors!.join('\n')),
      );
    } else if (result?.status === 'passed' && exitCode !== undefined && exitCode !== 0) {
      run.errored(
        item,
        new vscode.TestMessage(
          `Playwright exited with code ${exitCode} despite a passing test result.`,
        ),
      );
    } else if (result?.status === 'passed') run.passed(item, result.duration);
    else if (result?.status === 'skipped') run.skipped(item);
    else if (result?.status === 'flaky') {
      run.appendOutput('Test passed after retry (flaky).\r\n', undefined, item);
      run.passed(item, result.duration);
    } else if (result) {
      run.failed(
        item,
        new vscode.TestMessage(result.error ?? `Test ${result.status}`),
        result.duration,
      );
    } else if (exitCode === 0) run.passed(item);
    else
      run.failed(
        item,
        new vscode.TestMessage(`Playwright exited with code ${exitCode ?? 'unknown'}.`),
      );
  }

  private async waitForFreshResults(
    previous: TestResults | null,
    resource: string,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    if (token.isCancellationRequested) return false;
    const current = this.store.getResultsFor(resource);
    if (current && current !== previous) return true;
    if (!getConfig(resource).captureResults) return false;
    return await new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let changed: vscode.Disposable = new vscode.Disposable(() => undefined);
      let cancelled: vscode.Disposable = new vscode.Disposable(() => undefined);
      let finished = false;
      const finish = (fresh: boolean) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        changed.dispose();
        cancelled.dispose();
        resolve(fresh);
      };
      changed = this.store.onDidChange((results) => {
        if (results !== previous && this.store.getResultsFor(resource) === results) finish(true);
      });
      cancelled = token.onCancellationRequested(() => finish(false));
      if (finished) cancelled.dispose();
      else timer = setTimeout(() => finish(false), 2000);
    });
  }

  private async executeItems(
    run: vscode.TestRun,
    items: vscode.TestItem[],
    token: vscode.CancellationToken,
    debug: boolean,
    inspect = false,
  ): Promise<void> {
    for (const item of items) {
      if (token.isCancellationRequested) break;
      const target = this.targets.get(item.id);
      if (!target) continue;
      run.started(item);
      const options =
        target.kind === 'test' || target.kind === 'suite' ? { line: target.line } : {};
      const command = buildRunCommand(target.file, options);
      if (inspect) command.args.push('--debug');
      else if (debug) command.args.push('--headed');
      if (target.runtime && target.name)
        command.args.push('--grep', capturedTestPattern(target.name, target.titlePath));
      if (target.projectName !== undefined) command.args.push('--project', target.projectName);
      if (debug) {
        const debugName = `Debug ${item.label}`;
        const previous = this.store.getResultsFor(target.file);
        const started = await debugCommandAndWait(command, {
          resource: target.file,
          name: debugName,
          token,
        });
        if (!started) {
          run.failed(item, new vscode.TestMessage('The debug session could not be started.'));
          continue;
        }
        const fresh = await this.waitForFreshResults(previous, target.file, token);
        if (token.isCancellationRequested) run.skipped(item);
        else this.applyResult(run, item, undefined, fresh);
      } else {
        const previous = this.store.getResultsFor(target.file);
        const exitCode = await runCommandAndWait(command, {
          resource: target.file,
          name: `Playwright: ${item.label}`,
          token,
        });
        const fresh = await this.waitForFreshResults(previous, target.file, token);
        if (token.isCancellationRequested) run.skipped(item);
        else this.applyResult(run, item, exitCode, fresh);
      }
    }
  }

  private async run(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    debug: boolean,
    inspect = false,
  ): Promise<void> {
    const requested = this.requestedItems(request);
    const executeRun = async (items: vscode.TestItem[], label: string) => {
      const run = this.controller.createTestRun(request, label);
      try {
        await this.executeItems(run, items, token, debug, inspect);
      } catch (error) {
        const message = new vscode.TestMessage(
          error instanceof Error ? error.message : String(error),
        );
        for (const item of items) run.errored(item, message);
      } finally {
        run.end();
      }
    };
    await executeRun(
      requested,
      inspect ? 'Inspect Playwright' : debug ? 'Debug Playwright' : 'Run Playwright',
    );
    if (
      !(request as vscode.TestRunRequest & { continuous?: boolean }).continuous ||
      debug ||
      inspect ||
      token.isCancellationRequested
    )
      return;

    let queue = Promise.resolve();
    await new Promise<void>((resolve) => {
      const saved = vscode.workspace.onDidSaveTextDocument((document) => {
        const affected = requested.filter(
          (item) => this.targets.get(item.id)?.file === document.uri.fsPath,
        );
        if (!affected.length) return;
        queue = queue.then(() =>
          executeRun(affected, `Watch: ${path.basename(document.uri.fsPath)}`),
        );
      });
      const cancelled = token.onCancellationRequested(() => {
        saved.dispose();
        cancelled.dispose();
        resolve();
      });
    });
    await queue;
  }

  dispose(): void {
    this.disposed = true;
    ++this.refreshGeneration;
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.controller.dispose();
    this.treeChanged.dispose();
  }
}
