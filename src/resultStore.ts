import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { getResultsBaseDir, isResultsFileName } from './resultsPath';
import { parseReportJson, TestResults } from './resultParser';
import { atomicWriteFile, insideDirectory, readBoundedFile } from './fileSecurity';
import { boundedHistory, loadRunHistory } from './runHistory';
export type { RunSummary, SpecResult, SpecStatus, TestResults } from './resultParser';

export interface RunRecord extends TestResults {
  id: string;
  capturedAt: Date;
  workspaceRoot: string;
}

function parseReport(filePath: string, workspaceRoot: string): TestResults | null {
  try {
    const raw = readBoundedFile(filePath, 64 * 1024 * 1024).toString('utf8');
    return parseReportJson(raw, workspaceRoot);
  } catch {
    return null;
  }
}

export class ResultStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<TestResults>();
  readonly onDidChange = this._onDidChange.event;
  private readonly _onDidHistoryChange = new vscode.EventEmitter<readonly RunRecord[]>();
  readonly onDidHistoryChange = this._onDidHistoryChange.event;
  private _results: TestResults | null = null;
  private _history: RunRecord[] = [];
  private readonly _resultsByRoot = new Map<string, TestResults>();
  private readonly _mtimes = new Map<string, string>();
  private _pollTimer: NodeJS.Timeout | undefined;
  private readonly reloadTimers = new Map<string, NodeJS.Timeout>();
  private watcher?: vscode.FileSystemWatcher;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadHistory();
  }

  get results(): TestResults | null {
    return this._results;
  }

  get history(): readonly RunRecord[] {
    return this._history;
  }

  get allResults(): readonly TestResults[] {
    return [...this._resultsByRoot.values()];
  }

  getResultsFor(resource?: vscode.Uri | string): TestResults | null {
    const root = path.normalize(getConfig(resource).workingDirectory);
    return (
      this._resultsByRoot.get(root) ??
      [...this._resultsByRoot.entries()]
        .filter(([candidate]) => insideDirectory(candidate, root))
        .sort(([a], [b]) => b.length - a.length)[0]?.[1] ??
      null
    );
  }

  private get historyPath(): string {
    const storage = this.context.storageUri ?? this.context.globalStorageUri;
    return `${storage.fsPath}/run-history.json`;
  }

  private loadHistory(): void {
    this._history = boundedHistory(loadRunHistory(this.historyPath), this.historyLimit).records;
  }

  clearHistory(): void {
    this._history = [];
    this.writeHistory();
    this._onDidHistoryChange.fire(this._history);
  }

  private writeHistory(): void {
    const bounded = boundedHistory(this._history, this.historyLimit);
    this._history = bounded.records;
    try {
      atomicWriteFile(this.historyPath, bounded.json);
    } catch (error) {
      console.warn('Playwright Studio could not persist run history:', error);
    }
  }

  private get historyLimit(): number {
    return vscode.workspace.getConfiguration('playwrightSnippets').get<number>('historyLimit', 50);
  }

  private remember(results: TestResults, mtimeMs: number): void {
    const workspaceRoot = path.normalize(results.rootDir);
    const id = `${workspaceRoot}-${results.summary.startTime.getTime()}-${Math.round(mtimeMs)}`;
    if (this._history.some((record) => record.id === id)) return;
    const capturedAt = new Date();
    const compactResults: TestResults = {
      ...results,
      specs: results.specs.map((spec) => ({
        ...spec,
        error: spec.error?.slice(0, 100_000),
        output: spec.output?.slice(0, 100_000),
        attempts: spec.attempts?.map((attempt) => ({
          ...attempt,
          error: attempt.error?.slice(0, 100_000),
          output: attempt.output?.slice(0, 100_000),
          steps: attempt.steps.slice(0, 1000),
          attachments: attempt.attachments.map((attachment) => ({
            ...attachment,
            body:
              attachment.body && attachment.body.length <= 250_000 ? attachment.body : undefined,
          })),
        })),
        attachments: spec.attachments?.map((attachment) => ({
          ...attachment,
          body: attachment.body && attachment.body.length <= 250_000 ? attachment.body : undefined,
        })),
      })),
    };
    this._history.unshift({ id, capturedAt, workspaceRoot, ...compactResults });
    this.writeHistory();
    this._onDidHistoryChange.fire(this._history);
  }

  start(): void {
    if (this.disposed || this._pollTimer) return;
    this.tryLoadAll();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(getResultsBaseDir()),
        'playwright-studio-results*.json',
      ),
    );
    this.watcher = watcher;
    const reload = (uri: vscode.Uri) => {
      if (this.disposed) return;
      clearTimeout(this.reloadTimers.get(uri.fsPath));
      this.reloadTimers.set(
        uri.fsPath,
        setTimeout(() => {
          this.reloadTimers.delete(uri.fsPath);
          this.tryLoad(uri.fsPath);
        }, 300),
      );
    };
    watcher.onDidCreate(reload);
    watcher.onDidChange(reload);
    watcher.onDidDelete((uri) => this._mtimes.delete(uri.fsPath));

    // FileSystemWatcher is unreliable for paths outside workspace folders on
    // Windows. Poll mtime as a backup so the panel still refreshes.
    this._pollTimer = setInterval(() => this.pollMtime(), 1500);
  }

  private pollMtime(): void {
    this.tryLoadAll();
  }

  private resultFiles(): string[] {
    try {
      return fs
        .readdirSync(getResultsBaseDir())
        .filter(isResultsFileName)
        .map((name) => path.join(getResultsBaseDir(), name));
    } catch {
      return [];
    }
  }

  private tryLoadAll(): void {
    const files = new Set(this.resultFiles());
    for (const file of this._mtimes.keys()) if (!files.has(file)) this._mtimes.delete(file);
    for (const filePath of files) this.tryLoad(filePath);
  }

  private tryLoad(filePath: string): void {
    if (this.disposed) return;
    let mtimeMs: number;
    let signature: string;
    try {
      const stat = fs.lstatSync(filePath);
      mtimeMs = stat.mtimeMs;
      signature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
      if (this._mtimes.get(filePath) === signature) return;
      this._mtimes.set(filePath, signature);
      if (!stat.isFile()) return;
    } catch {
      return;
    }
    const parsed = parseReport(filePath, getConfig().workingDirectory);
    if (parsed) {
      this._results = parsed;
      this._resultsByRoot.set(path.normalize(parsed.rootDir), parsed);
      this.remember(parsed, mtimeMs);
      this._onDidChange.fire(parsed);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.watcher?.dispose();
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    this.reloadTimers.clear();
    this._onDidChange.dispose();
    this._onDidHistoryChange.dispose();
  }
}
