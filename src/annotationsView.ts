import * as vscode from 'vscode';
import { ResultStore, SpecResult } from './resultStore';

class AnnotationGroup extends vscode.TreeItem {
  readonly kind = 'group' as const;
  constructor(
    public readonly key: string,
    public readonly specs: SpecResult[],
  ) {
    super(key, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${specs.length} ${specs.length === 1 ? 'test' : 'tests'}`;
    this.iconPath = new vscode.ThemeIcon(
      /severity|critical|blocker/i.test(key)
        ? 'warning'
        : /quarantine|fixme/i.test(key)
          ? 'debug-pause'
          : 'tag',
    );
  }
}

class AnnotatedSpec extends vscode.TreeItem {
  readonly kind = 'spec' as const;
  constructor(public readonly spec: SpecResult) {
    super(spec.title, vscode.TreeItemCollapsibleState.None);
    this.description = [spec.projectName, spec.status].filter(Boolean).join(' · ');
    this.tooltip = `${spec.file}:${spec.line + 1}`;
    this.iconPath = new vscode.ThemeIcon(
      spec.status === 'failed' || spec.status === 'timedOut' ? 'error' : 'beaker',
    );
    this.command = {
      command: 'vscode.open',
      title: 'Open annotated test',
      arguments: [
        vscode.Uri.file(spec.file),
        { selection: new vscode.Range(spec.line, 0, spec.line, 0) },
      ],
    };
  }
}

type AnnotationNode = AnnotationGroup | AnnotatedSpec;

export class AnnotationsViewProvider
  implements vscode.TreeDataProvider<AnnotationNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<AnnotationNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: ResultStore) {
    this.subscription = store.onDidChange(() => this.changed.fire(undefined));
  }

  getTreeItem(element: AnnotationNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AnnotationNode): AnnotationNode[] {
    if (element?.kind === 'group') return element.specs.map((spec) => new AnnotatedSpec(spec));
    if (element) return [];
    const groups = new Map<string, SpecResult[]>();
    for (const spec of this.store.allResults.flatMap((results) => results.specs)) {
      const labels = [
        ...(spec.annotations ?? []).map(
          (annotation) =>
            `${annotation.type}${annotation.description ? `: ${annotation.description}` : ''}`,
        ),
        ...(spec.tags ?? []),
      ];
      for (const label of new Set(labels)) groups.set(label, [...(groups.get(label) ?? []), spec]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, specs]) => new AnnotationGroup(key, specs));
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
