import * as path from 'path';

export type SpecStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'flaky';

export interface SpecResult {
  title: string;
  file: string;
  line: number;
  status: SpecStatus;
  duration: number;
  projectName?: string;
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

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function stripTerminalFormatting(value: string): string {
  return value
    // OSC sequences, including terminal hyperlinks.
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    // CSI sequences such as Playwright/expect's color and emphasis codes.
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g, '');
}

function outcome(test: JsonObject, finalResult: JsonObject | undefined): SpecStatus {
  switch (test.status) {
    case 'expected':
      return 'passed';
    case 'unexpected':
      return finalResult?.status === 'timedOut' ? 'timedOut' : 'failed';
    case 'flaky':
      return 'flaky';
    default:
      return 'skipped';
  }
}

function resolvePath(filePath: string, rootDir: string): string {
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(rootDir, filePath);
}

function lastError(results: JsonObject[]): string | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    const error = object(results[i].error);
    const message = string(error?.message) ?? string(error?.value);
    if (message) return stripTerminalFormatting(message);
  }
  return undefined;
}

function lastTrace(results: JsonObject[], rootDir: string): string | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    for (const value of array(results[i].attachments)) {
      const attachment = object(value);
      if (attachment?.name !== 'trace') continue;
      const tracePath = string(attachment.path);
      if (tracePath) return resolvePath(tracePath, rootDir);
    }
  }
  return undefined;
}

function flattenSuites(suites: unknown[], specs: SpecResult[], rootDir: string): void {
  for (const value of suites) {
    const suite = object(value);
    if (!suite) continue;
    flattenSuites(array(suite.suites), specs, rootDir);

    for (const specValue of array(suite.specs)) {
      const spec = object(specValue);
      const title = string(spec?.title);
      const file = string(spec?.file);
      if (!spec || !title || !file) continue;

      for (const testValue of array(spec.tests)) {
        const test = object(testValue);
        if (!test) continue;
        const results = array(test.results).map(object).filter((item): item is JsonObject => !!item);
        const finalResult = results[results.length - 1];

        specs.push({
          title,
          file: resolvePath(file, rootDir),
          line: Math.max(0, number(spec.line, 1) - 1),
          status: outcome(test, finalResult),
          duration: results.reduce((total, result) => total + number(result.duration), 0),
          projectName: string(test.projectName),
          error: lastError(results),
          traceFile: lastTrace(results, rootDir),
        });
      }
    }
  }
}

export function parseReportJson(raw: string, fallbackRoot: string): TestResults | null {
  try {
    const report = object(JSON.parse(raw));
    if (!report) return null;
    const config = object(report.config);
    const rootDir = string(config?.rootDir) ?? fallbackRoot;
    const specs: SpecResult[] = [];
    flattenSuites(array(report.suites), specs, rootDir);
    const stats = object(report.stats) ?? {};
    const parsedStart = new Date(string(stats.startTime) ?? '');

    return {
      specs,
      summary: {
        passed: number(stats.expected, specs.filter(spec => spec.status === 'passed').length),
        failed: number(
          stats.unexpected,
          specs.filter(spec => spec.status === 'failed' || spec.status === 'timedOut').length
        ),
        skipped: number(stats.skipped, specs.filter(spec => spec.status === 'skipped').length),
        flaky: number(stats.flaky, specs.filter(spec => spec.status === 'flaky').length),
        duration: number(stats.duration),
        startTime: Number.isNaN(parsedStart.getTime()) ? new Date(0) : parsedStart,
      },
    };
  } catch {
    return null;
  }
}
