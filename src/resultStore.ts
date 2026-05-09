import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from './config';
import { getResultsBaseDir, getResultsFileName, getResultsFilePath } from './resultsPath';

export type SpecStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'flaky';

export interface SpecResult {
  title: string;
  file: string;
  line: number; // 0-indexed
  status: SpecStatus;
  duration: number;
  error?: string;
  traceFile?: string;
}

export interface RunSummary {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration: number;
  startTime: Date;
}

export interface TestResults {
  specs: SpecResult[];
  summary: RunSummary;
}

function resolveSpecFile(filePath: string, workspaceRoot: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(workspaceRoot, filePath);
}

function flattenSuites(suites: any[], results: SpecResult[], workspaceRoot: string): void {
  for (const suite of suites) {
    flattenSuites(suite.suites ?? [], results, workspaceRoot);
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      if (!test) continue;
      const result = test.results?.[0];

      let status: SpecStatus = 'skipped';
      if (test.status === 'expected') status = 'passed';
      else if (test.status === 'unexpected') {
        status = result?.status === 'timedOut' ? 'timedOut' : 'failed';
      } else if (test.status === 'flaky') status = 'flaky';

      const traceAttachment = result?.attachments?.find(
        (a: any) => a.name === 'trace' && a.path
      );

      results.push({
        title: spec.title,
        file: resolveSpecFile(spec.file ?? '', workspaceRoot),
        line: Math.max(0, (spec.line ?? 1) - 1),
        status,
        duration: result?.duration ?? 0,
        error: result?.error?.message,
        traceFile: traceAttachment?.path,
      });
    }
  }
}

function parseReport(filePath: string, workspaceRoot: string): TestResults | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    const specs: SpecResult[] = [];
    flattenSuites(json.suites ?? [], specs, workspaceRoot);
    const stats = json.stats ?? {};
    return {
      specs,
      summary: {
        passed: stats.expected ?? specs.filter(s => s.status === 'passed').length,
        failed: stats.unexpected ?? specs.filter(s => s.status === 'failed' || s.status === 'timedOut').length,
        skipped: stats.skipped ?? specs.filter(s => s.status === 'skipped').length,
        flaky: stats.flaky ?? specs.filter(s => s.status === 'flaky').length,
        duration: stats.duration ?? 0,
        startTime: stats.startTime ? new Date(stats.startTime) : new Date(),
      },
    };
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
