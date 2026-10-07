import * as vscode from 'vscode';
import * as fs from 'fs';
import { getConfig } from './config';
import { getResultsBaseDir, getResultsFileName, getResultsFilePath } from './resultsPath';
import { parseReportJson, TestResults } from './resultParser';
export type { RunSummary, SpecResult, SpecStatus, TestResults } from './resultParser';

function parseReport(filePath: string, workspaceRoot: string): TestResults | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseReportJson(raw, workspaceRoot);
  } catch {
    return null;
  }
}

export class ResultStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<TestResults>();
  readonly onDidChange = this._onDidChange.event;
  private _results: TestResults | null = null;
  private _lastMtimeMs = 0;
  private _pollTimer: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get results(): TestResults | null {
    return this._results;
  }

  start(): void {
    this.tryLoad();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(getResultsBaseDir()), getResultsFileName())
    );
    const reload = () => setTimeout(() => this.tryLoad(), 300);
    watcher.onDidCreate(reload);
    watcher.onDidChange(reload);
    this.context.subscriptions.push(watcher);

    // FileSystemWatcher is unreliable for paths outside workspace folders on
    // Windows. Poll mtime as a backup so the panel still refreshes.
    this._pollTimer = setInterval(() => this.pollMtime(), 1500);
  }

  private pollMtime(): void {
    try {
      const stat = fs.statSync(getResultsFilePath());
      if (stat.mtimeMs !== this._lastMtimeMs) {
        this._lastMtimeMs = stat.mtimeMs;
        this.tryLoad();
      }
    } catch {
      // file doesn't exist yet — nothing to do
    }
  }

  private tryLoad(): void {
    const parsed = parseReport(getResultsFilePath(), getConfig().workingDirectory);
    if (parsed) {
      this._results = parsed;
      this._onDidChange.fire(parsed);
    }
  }

  dispose(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._onDidChange.dispose();
  }
}
