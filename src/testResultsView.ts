import * as vscode from 'vscode';
import * as path from 'path';
import { ResultStore, SpecResult, SpecStatus } from './resultStore';

class FileNode extends vscode.TreeItem {
  readonly kind = 'file' as const;
  constructor(
    public readonly filePath: string,
    public readonly specs: SpecResult[]
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.Expanded);
    const failed = specs.filter(s => s.status === 'failed' || s.status === 'timedOut').length;
    const passed = specs.filter(s => s.status === 'passed').length;
    const flaky = specs.filter(s => s.status === 'flaky').length;
    const parts = [`${passed} passed`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (flaky > 0) parts.push(`${flaky} flaky`);
    this.description = parts.join(', ');
    this.tooltip = filePath;
    this.resourceUri = vscode.Uri.file(filePath);
    this.iconPath =
      failed > 0
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    this.contextValue = 'playwrightResultFile';
  }
}

class SpecNode extends vscode.TreeItem {
  readonly kind = 'spec' as const;
  constructor(public readonly spec: SpecResult) {
    super(spec.title, vscode.TreeItemCollapsibleState.None);
    this.description = `${spec.duration}ms`;
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

type TreeNode = FileNode | SpecNode;

export class TestResultsViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private fileNodes: FileNode[] = [];

  constructor(store: ResultStore) {
    store.onDidChange(results => {
      const byFile = new Map<string, SpecResult[]>();
      for (const spec of results.specs) {
        const arr = byFile.get(spec.file) ?? [];
        arr.push(spec);
        byFile.set(spec.file, arr);
      }
      this.fileNodes = [...byFile.entries()].map(([file, specs]) => new FileNode(file, specs));
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) return this.fileNodes;
    if (element.kind === 'file') return element.specs.map(s => new SpecNode(s));
    return [];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
