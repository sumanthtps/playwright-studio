import * as vscode from 'vscode';
import { ResultStore } from './resultStore';
import { parseTests } from './testParser';

const STATE_KEY = 'playwright.testLastRun';

type LastRunMap = Record<string, number>;

function testKey(filePath: string, line: number, title: string): string {
  return `${filePath}::${line}::${title}`;
}

export class CoverageHeatmap implements vscode.Disposable {
  private readonly coldType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    store: ResultStore
  ) {
    this.coldType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(255, 180, 0, 0.07)',
      overviewRulerColor: 'rgba(255, 180, 0, 0.5)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        color: 'rgba(255, 180, 0, 0.5)',
        fontStyle: 'italic',
        margin: '0 0 0 12px',
      },
    });

    this.disposables.push(
      store.onDidChange(results => {
        const lastRun = this.context.workspaceState.get<LastRunMap>(STATE_KEY, {});
        const runAt = results.summary.startTime.getTime();
        if (runAt <= 0) return;
        for (const spec of results.specs) {
          if (spec.status !== 'skipped') {
            const key = testKey(spec.file, spec.line, spec.title);
            lastRun[key] = Math.max(lastRun[key] ?? 0, runAt);
          }
        }
        void this.context.workspaceState.update(STATE_KEY, lastRun);
        this.updateEditors();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateEditors()),
      vscode.workspace.onDidOpenTextDocument(() => this.updateEditors()),
      vscode.workspace.onDidChangeTextDocument(() => this.updateEditors()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('playwrightSnippets.heatmapThresholdDays')) {
          this.updateEditors();
        }
      })
    );

    this.updateEditors();
  }

  private updateEditors(): void {
    const lastRun = this.context.workspaceState.get<LastRunMap>(STATE_KEY, {});
    const thresholdDays = vscode.workspace
      .getConfiguration('playwrightSnippets')
      .get<number>('heatmapThresholdDays', 7);
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;
      const cold: vscode.DecorationOptions[] = [];

      for (const test of parseTests(editor.document).filter(item => item.kind === 'test')) {
        const key = testKey(filePath, test.line, test.name);
        const lastRunTime = lastRun[key];
        const isCold = !lastRunTime || now - lastRunTime > thresholdMs;

        if (isCold) {
          const hoverMsg = lastRunTime
            ? `Last run: ${new Date(lastRunTime).toLocaleDateString()} (${Math.floor((now - lastRunTime) / 86400000)}d ago)`
            : 'This test has never been run via Playwright Studio';
          cold.push({
            range: editor.document.lineAt(test.line).range,
            hoverMessage: hoverMsg,
            renderOptions: {
              after: { contentText: lastRunTime ? ' stale' : ' never run' },
            },
          });
        }
      }

      editor.setDecorations(this.coldType, cold);
    }
  }

  dispose(): void {
    this.coldType.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
