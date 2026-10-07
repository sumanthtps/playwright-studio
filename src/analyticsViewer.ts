import * as vscode from 'vscode';
import { ResultStore } from './resultStore';
import { randomBytes } from 'crypto';
import { analyticsScript } from './webviews/analytics';

function nonce(): string {
  return randomBytes(24).toString('base64');
}

export class AnalyticsViewer implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscription: vscode.Disposable;
  constructor(private readonly store: ResultStore) {
    this.subscription = store.onDidHistoryChange(() => {
      if (this.panel) this.panel.webview.html = this.html();
    });
  }

  show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'playwrightStudio.analytics',
        'Playwright Analytics',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.webview.html = this.html();
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private html(): string {
    const token = nonce();
    const histories = this.store.history.map((record) => ({
      root: record.workspaceRoot,
      capturedAt: record.capturedAt.toISOString(),
      specs: record.specs.map((spec) => ({
        key: JSON.stringify([
          spec.file,
          spec.line,
          spec.projectName,
          spec.titlePath ?? [spec.title],
        ]),
        title: spec.title,
        project: spec.projectName ?? 'default',
        status: spec.status,
        duration: spec.duration,
      })),
    }));
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${token}'; script-src 'nonce-${token}';">
      <style nonce="${token}">:root{color-scheme:light dark}body{font:13px var(--vscode-font-family);padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}h1{margin-top:0}.filters{display:flex;gap:12px;flex-wrap:wrap}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}.card,section{border:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);border-radius:6px;padding:12px}.metric{font-size:22px;font-weight:600}.muted{color:var(--vscode-descriptionForeground)}select{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:5px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--vscode-panel-border);padding:7px}th{position:sticky;top:0;background:var(--vscode-sideBar-background)}.trend{display:flex;align-items:end;gap:3px;height:150px;padding-top:10px}.bar{min-width:8px;flex:1;background:var(--vscode-testing-iconPassed,#2ea043);position:relative}.bar.fail{background:var(--vscode-testing-iconFailed,#f85149)}.bar:focus-visible{outline:2px solid var(--vscode-focusBorder)}section{margin:12px 0;overflow:auto}</style></head><body>
      <h1>Playwright analytics</h1><div class="filters"><label>Workspace <select id="root"></select></label><label>Project <select id="project"></select></label></div>
      <div class="cards" id="cards"></div><section><h2>Failure trend</h2><div id="trend" class="trend" role="img" aria-label="Failures by run"></div></section>
      <section><h2>Unstable tests</h2><table><thead><tr><th>Test</th><th>Project</th><th>Runs</th><th>Failed</th><th>Flaky</th><th>Rate</th></tr></thead><tbody id="unstable"></tbody></table></section>
      <section><h2>Slowest tests</h2><table><thead><tr><th>Test</th><th>Project</th><th>Runs</th><th>Average</th></tr></thead><tbody id="slow"></tbody></table></section>
      <script nonce="${token}">${analyticsScript(histories)}</script></body></html>`;
  }

  dispose(): void {
    this.subscription.dispose();
    this.panel?.dispose();
  }
}
