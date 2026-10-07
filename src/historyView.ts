import * as vscode from 'vscode';
import * as path from 'path';
import { ResultStore, RunRecord, SpecResult } from './resultStore';

class RunNode extends vscode.TreeItem {
  readonly kind = 'run' as const;
  constructor(public readonly record: RunRecord) {
    super(
      `${path.basename(record.workspaceRoot) || record.workspaceRoot} · ${record.capturedAt.toLocaleString()}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    const summary = record.summary;
    this.description = `${summary.passed} passed · ${summary.failed} failed · ${summary.duration}ms`;
    this.tooltip = `Run started ${summary.startTime.toLocaleString()}`;
    this.iconPath = summary.failed
      ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
      : summary.flaky
        ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFlaky'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    this.contextValue = 'playwrightHistoryRun';
  }
}

class HistoricalSpecNode extends vscode.TreeItem {
  readonly kind = 'spec' as const;
  constructor(public readonly spec: SpecResult) {
    const details = !!spec.error || !!spec.output || (spec.attachments?.length ?? 0) > 0;
    super(
      spec.title,
      details ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.description = [spec.status, spec.projectName, `${spec.duration}ms`]
      .filter(Boolean)
      .join(' · ');
    this.tooltip = spec.error ?? spec.file;
    this.iconPath = new vscode.ThemeIcon(
      spec.status === 'passed'
        ? 'pass'
        : spec.status === 'flaky'
          ? 'warning'
          : spec.status === 'skipped'
            ? 'debug-step-over'
            : 'error',
    );
    this.command = {
      command: 'vscode.open',
      title: 'Open Test',
      arguments: [
        vscode.Uri.file(spec.file),
        { selection: new vscode.Range(spec.line, 0, spec.line, 0) },
      ],
    };
  }
}

class HistoricalArtifactNode extends vscode.TreeItem {
  readonly kind = 'artifact' as const;
  constructor(
    public readonly spec: SpecResult,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('open-preview');
    this.command = {
      command: 'playwrightSnippets.openArtifact',
      title: 'Open historical artifacts',
      arguments: [{ spec }],
    };
  }
}

type HistoryNode = RunNode | HistoricalSpecNode | HistoricalArtifactNode;

export class HistoryViewProvider
  implements vscode.TreeDataProvider<HistoryNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<HistoryNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: ResultStore) {
    this.subscription = store.onDidHistoryChange(() => this.changeEmitter.fire(undefined));
  }

  getTreeItem(element: HistoryNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryNode): HistoryNode[] {
    if (!element) return this.store.history.map((record) => new RunNode(record));
    if (element.kind === 'run') {
      return [...element.record.specs]
        .sort((a, b) => {
          const rank = (spec: SpecResult) =>
            spec.status === 'failed' || spec.status === 'timedOut'
              ? 0
              : spec.status === 'flaky'
                ? 1
                : 2;
          return rank(a) - rank(b) || b.duration - a.duration;
        })
        .map((spec) => new HistoricalSpecNode(spec));
    }
    if (element.kind === 'spec') {
      const count = element.spec.attachments?.length ?? 0;
      return [
        new HistoricalArtifactNode(
          element.spec,
          count ? `Review ${count} artifact${count === 1 ? '' : 's'}` : 'Review failure details',
        ),
      ];
    }
    return [];
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}

export function historyMarkdown(store: ResultStore): string {
  const histories = store.history;
  const lines = ['# Playwright run history', ''];
  for (const record of histories) {
    const summary = record.summary;
    lines.push(
      `## ${record.capturedAt.toLocaleString()}`,
      '',
      `Passed: ${summary.passed} · Failed: ${summary.failed} · Flaky: ${summary.flaky} · Skipped: ${summary.skipped} · Duration: ${summary.duration}ms`,
      '',
    );
    for (const spec of record.specs.filter((item) => item.status !== 'passed')) {
      lines.push(
        `- **${spec.status}** ${spec.title} (${spec.projectName ?? 'default'}, ${spec.duration}ms)`,
      );
    }
    lines.push('');
  }
  if (!histories.length) lines.push('No captured runs yet.');
  return lines.join('\n');
}

export function analyticsMarkdown(store: ResultStore): string {
  const aggregate = new Map<
    string,
    { title: string; runs: number; failed: number; flaky: number; duration: number }
  >();
  for (const run of store.history) {
    for (const spec of run.specs) {
      const key = JSON.stringify([
        spec.file,
        spec.line,
        spec.projectName,
        spec.titlePath ?? [spec.title],
      ]);
      const item = aggregate.get(key) ?? {
        title: spec.title,
        runs: 0,
        failed: 0,
        flaky: 0,
        duration: 0,
      };
      item.runs++;
      item.failed += spec.status === 'failed' || spec.status === 'timedOut' ? 1 : 0;
      item.flaky += spec.status === 'flaky' ? 1 : 0;
      item.duration += spec.duration;
      aggregate.set(key, item);
    }
  }
  const items = [...aggregate.values()];
  const lines = ['# Playwright analytics', '', `Runs retained: ${store.history.length}`, ''];
  lines.push('## Flakiest / most failing tests', '');
  for (const item of items.sort((a, b) => b.failed + b.flaky - (a.failed + a.flaky)).slice(0, 20)) {
    const rate = item.runs ? Math.round(((item.failed + item.flaky) / item.runs) * 100) : 0;
    lines.push(
      `- ${item.title}: ${rate}% unstable (${item.failed} failed, ${item.flaky} flaky / ${item.runs} runs)`,
    );
  }
  lines.push('', '## Slowest tests', '');
  for (const item of items.sort((a, b) => b.duration / b.runs - a.duration / a.runs).slice(0, 20)) {
    lines.push(`- ${item.title}: ${Math.round(item.duration / item.runs)}ms average`);
  }
  return lines.join('\n');
}
