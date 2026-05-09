import * as vscode from 'vscode';
import { ResultStore } from './resultStore';

const STATE_KEY = 'playwright.testLastRun';
const TEST_LINE_RE = /^\s*(?:test|it)(?:\.only|\.skip|\.fixme|\.fail)?\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/;

type LastRunMap = Record<string, number>;

function testKey(filePath: string, title: string): string {
  return `${filePath}::${title}`;
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
        contentText: ' never run',
        color: 'rgba(255, 180, 0, 0.5)',
        fontStyle: 'italic',
        margin: '0 0 0 12px',
      },
    });

    this.disposables.push(
      store.onDidChange(results => {
        const lastRun = this.context.workspaceState.get<LastRunMap>(STATE_KEY, {});
        const now = Date.now();
        for (const spec of results.specs) {
          if (spec.status !== 'skipped') {
            lastRun[testKey(spec.file, spec.title)] = now;
          }
        }
        void this.context.workspaceState.update(STATE_KEY, lastRun);
        this.updateEditors();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateEditors()),
      vscode.workspace.onDidOpenTextDocument(() => this.updateEditors())
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

      for (let i = 0; i < editor.document.lineCount; i++) {
        const text = editor.document.lineAt(i).text;
        const match = TEST_LINE_RE.exec(text);
        if (!match) continue;

        const key = testKey(filePath, match[2]);
        const lastRunTime = lastRun[key];
        const isCold = !lastRunTime || now - lastRunTime > thresholdMs;

        if (isCold) {
          const hoverMsg = lastRunTime
            ? `Last run: ${new Date(lastRunTime).toLocaleDateString()} (${Math.floor((now - lastRunTime) / 86400000)}d ago)`
            : 'This test has never been run via Playwright Studio';
          cold.push({
            range: editor.document.lineAt(i).range,
            hoverMessage: hoverMsg,
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
