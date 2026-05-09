import * as vscode from 'vscode';
import { ResultStore, SpecResult } from './resultStore';

export class GutterDecorationManager implements vscode.Disposable {
  private readonly passType: vscode.TextEditorDecorationType;
  private readonly failType: vscode.TextEditorDecorationType;
  private readonly skipType: vscode.TextEditorDecorationType;
  private readonly flakyType: vscode.TextEditorDecorationType;
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    store: ResultStore
  ) {
    const icon = (name: string) =>
      vscode.Uri.file(context.asAbsolutePath(`images/${name}`));

    this.passType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('pass.svg'),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('testing.iconPassed'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.failType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('fail.svg'),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('testing.iconFailed'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.skipType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('skip.svg'),
      gutterIconSize: 'contain',
    });

    this.flakyType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: icon('flaky.svg'),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('testing.iconFlaky'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.diagnostics = vscode.languages.createDiagnosticCollection('playwright-studio');
    this.context.subscriptions.push(this.diagnostics);

    this.disposables.push(
      store.onDidChange(() => this.update(store)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.update(store))
    );
  }

  private update(store: ResultStore): void {
    const results = store.results;
    if (!results) return;

    this.diagnostics.clear();

    const byFile = new Map<string, SpecResult[]>();
    for (const spec of results.specs) {
      const arr = byFile.get(spec.file) ?? [];
      arr.push(spec);
      byFile.set(spec.file, arr);
    }

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;
      const fileSpecs = byFile.get(filePath) ?? [];

      const passed: vscode.DecorationOptions[] = [];
      const failed: vscode.DecorationOptions[] = [];
      const skipped: vscode.DecorationOptions[] = [];
      const flaky: vscode.DecorationOptions[] = [];
      const diagnosticList: vscode.Diagnostic[] = [];

      for (const spec of fileSpecs) {
        const lineIdx = Math.max(0, Math.min(spec.line, editor.document.lineCount - 1));
        const range = editor.document.lineAt(lineIdx).range;

        if (spec.status === 'passed') {
          passed.push({ range });
        } else if (spec.status === 'failed' || spec.status === 'timedOut') {
          failed.push({ range });

          const message = spec.error
            ? spec.error.split('\n')[0]
            : `Test "${spec.title}" failed`;
          const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
          diag.source = 'Playwright Studio';

          if (spec.traceFile) {
            diag.code = {
              value: 'Open Trace',
              target: vscode.Uri.parse(
                `command:playwrightSnippets.showTrace?${encodeURIComponent(JSON.stringify([spec.traceFile]))}`
              ),
            };
          }
          diagnosticList.push(diag);
        } else if (spec.status === 'skipped') {
          skipped.push({ range });
        } else if (spec.status === 'flaky') {
          flaky.push({ range });
        }
      }

      editor.setDecorations(this.passType, passed);
      editor.setDecorations(this.failType, failed);
      editor.setDecorations(this.skipType, skipped);
      editor.setDecorations(this.flakyType, flaky);

      if (diagnosticList.length > 0) {
        this.diagnostics.set(editor.document.uri, diagnosticList);
      } else {
        this.diagnostics.delete(editor.document.uri);
      }
    }
  }

  dispose(): void {
    this.passType.dispose();
    this.failType.dispose();
    this.skipType.dispose();
    this.flakyType.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
