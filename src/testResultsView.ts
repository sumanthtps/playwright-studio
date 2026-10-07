import * as vscode from 'vscode';
import * as path from 'path';
import { ResultStore, SpecResult, SpecStatus, TestResults } from './resultStore';
import { TestAttachment } from './resultParser';

class FileNode extends vscode.TreeItem {
  readonly kind = 'file' as const;
  constructor(
    public readonly filePath: string,
    public readonly specs: SpecResult[],
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.Expanded);
    const failed = specs.filter((s) => s.status === 'failed' || s.status === 'timedOut').length;
    const passed = specs.filter((s) => s.status === 'passed').length;
    const flaky = specs.filter((s) => s.status === 'flaky').length;
    const skipped = specs.filter((s) => s.status === 'skipped').length;
    const parts = [`${passed} passed`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (flaky > 0) parts.push(`${flaky} flaky`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    this.description = parts.join(', ');
    this.tooltip = filePath;
    this.resourceUri = vscode.Uri.file(filePath);
    this.iconPath =
      failed > 0
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        : flaky > 0
          ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFlaky'))
          : skipped === specs.length
            ? new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'))
            : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    this.contextValue = 'playwrightResultFile';
  }
}

class WorkspaceNode extends vscode.TreeItem {
  readonly kind = 'workspace' as const;
  constructor(public readonly results: TestResults) {
    super(
      path.basename(results.rootDir) || results.rootDir,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    this.tooltip = results.rootDir;
    this.description = `${results.summary.passed} passed · ${results.summary.failed} failed`;
    this.iconPath = new vscode.ThemeIcon('root-folder');
  }
}

class SpecNode extends vscode.TreeItem {
  readonly kind = 'spec' as const;
  constructor(public readonly spec: SpecResult) {
    const hasDetails = !!spec.output || !!spec.error || (spec.attachments?.length ?? 0) > 0;
    super(
      spec.title,
      hasDetails ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.description = [spec.projectName, `${spec.duration}ms`].filter(Boolean).join(' · ');
    this.tooltip = spec.error ?? spec.title;
    this.iconPath = statusIcon(spec.status);
    this.command = {
      command: 'vscode.open',
      title: 'Go to Test',
      arguments: [
        vscode.Uri.file(spec.file),
        { selection: new vscode.Range(spec.line, 0, spec.line, 0) },
      ],
    };
    this.contextValue = spec.traceFile ? 'playwrightSpecWithTrace' : 'playwrightSpec';
  }
}

class ArtifactNode extends vscode.TreeItem {
  readonly kind = 'artifact' as const;
  constructor(
    public readonly spec: SpecResult,
    public readonly attachment?: TestAttachment,
    public readonly detailKind: 'attachment' | 'error' | 'output' = 'attachment',
  ) {
    super(
      attachment?.name ?? (detailKind === 'error' ? 'Error details' : 'Captured output'),
      vscode.TreeItemCollapsibleState.None,
    );
    const filePath = attachment?.path;
    this.description = attachment?.contentType;
    this.tooltip =
      filePath ?? attachment?.body ?? (detailKind === 'error' ? spec.error : spec.output);
    this.iconPath = new vscode.ThemeIcon(
      attachment?.name === 'trace'
        ? 'open-preview'
        : attachment?.contentType?.startsWith('image/')
          ? 'file-media'
          : attachment?.contentType?.startsWith('video/')
            ? 'device-camera-video'
            : 'file',
    );
    this.contextValue =
      attachment?.name === 'trace' ? 'playwrightArtifactTrace' : 'playwrightArtifact';
    this.command = {
      command:
        attachment?.name === 'trace'
          ? 'playwrightSnippets.showTrace'
          : 'playwrightSnippets.openArtifact',
      title: 'Open Artifact',
      arguments: [attachment?.name === 'trace' ? attachment.path : this],
    };
  }
}

function statusIcon(status: SpecStatus): vscode.ThemeIcon {
  switch (status) {
    case 'passed':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'failed':
    case 'timedOut':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'skipped':
      return new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'));
    case 'flaky':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFlaky'));
  }
}

type TreeNode = WorkspaceNode | FileNode | SpecNode | ArtifactNode;

export class TestResultsViewProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly byRoot = new Map<string, TestResults>();
  private readonly subscription: vscode.Disposable;

  constructor(store: ResultStore) {
    for (const results of store.allResults) this.byRoot.set(results.rootDir, results);
    this.subscription = store.onDidChange((results) => {
      this.byRoot.set(results.rootDir, results);
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) return [...this.byRoot.values()].map((results) => new WorkspaceNode(results));
    if (element.kind === 'workspace') {
      const byFile = new Map<string, SpecResult[]>();
      for (const spec of element.results.specs)
        byFile.set(spec.file, [...(byFile.get(spec.file) ?? []), spec]);
      return [...byFile.entries()].map(([file, specs]) => new FileNode(file, specs));
    }
    if (element.kind === 'file') return element.specs.map((s) => new SpecNode(s));
    if (element.kind === 'spec') {
      const nodes: ArtifactNode[] = [];
      if (element.spec.error) nodes.push(new ArtifactNode(element.spec, undefined, 'error'));
      if (element.spec.output) nodes.push(new ArtifactNode(element.spec, undefined, 'output'));
      for (const attachment of element.spec.attachments ?? []) {
        nodes.push(new ArtifactNode(element.spec, attachment));
      }
      return nodes;
    }
    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
