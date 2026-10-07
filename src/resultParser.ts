import * as path from 'path';
import type { RevisionEvidence } from './intelligence/model';

export interface TestAttempt {
  retry: number;
  status: string;
  duration: number;
  startTime?: string;
  error?: string;
  output?: string;
  attachments: TestAttachment[];
  steps: { title: string; duration: number; error?: string }[];
}

export type SpecStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'flaky';

export interface TestAttachment {
  name: string;
  contentType?: string;
  path?: string;
  body?: string;
}

export interface TestAnnotation {
  type: string;
  description?: string;
}

export interface SpecResult {
  testId?: string;
  attempts?: TestAttempt[];
  title: string;
  titlePath?: string[];
  file: string;
  line: number;
  status: SpecStatus;
  duration: number;
  projectName?: string;
  error?: string;
  traceFile?: string;
  tags?: string[];
  annotations?: TestAnnotation[];
  attachments?: TestAttachment[];
  output?: string;
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
  errors?: string[];
  evidence?: RevisionEvidence;
  specs: SpecResult[];
  summary: RunSummary;
  rootDir: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
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
  return (
    value
      // OSC sequences, including terminal hyperlinks.
      .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
      // CSI sequences such as Playwright/expect's color and emphasis codes.
      .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g, '')
  );
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
  if (filePath.includes('\0') || rootDir.includes('\0')) throw new Error('Invalid report path.');
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

function attachments(results: JsonObject[], rootDir: string): TestAttachment[] {
  const values: TestAttachment[] = [];
  for (const result of results) {
    for (const value of array(result.attachments)) {
      const attachment = object(value);
      const name = string(attachment?.name);
      if (!name) continue;
      const attachmentPath = string(attachment?.path);
      values.push({
        name,
        contentType: string(attachment?.contentType),
        path: attachmentPath ? resolvePath(attachmentPath, rootDir) : undefined,
        body: string(attachment?.body),
      });
    }
  }
  return values;
}

function annotations(test: JsonObject): TestAnnotation[] {
  return array(test.annotations).flatMap((value) => {
    const annotation = object(value);
    const type = string(annotation?.type);
    return type ? [{ type, description: string(annotation?.description) }] : [];
  });
}

function capturedOutput(results: JsonObject[]): string | undefined {
  const lines: string[] = [];
  for (const result of results) {
    for (const stream of ['stdout', 'stderr']) {
      for (const value of array(result[stream])) {
        if (typeof value === 'string') lines.push(value);
        else {
          const item = object(value);
          const text =
            string(item?.text) ??
            (() => {
              const buffer = string(item?.buffer);
              return buffer ? Buffer.from(buffer, 'base64').toString('utf8') : undefined;
            })();
          if (text) lines.push(text);
        }
      }
    }
  }
  const joined = stripTerminalFormatting(lines.join('')).trim();
  return joined || undefined;
}

function flattenSuites(
  suites: unknown[],
  specs: SpecResult[],
  rootDir: string,
  parents: string[] = [],
): void {
  for (const value of suites) {
    const suite = object(value);
    if (!suite) continue;
    const suiteTitle = string(suite.title);
    const titlePath = suiteTitle ? [...parents, suiteTitle] : parents;
    flattenSuites(array(suite.suites), specs, rootDir, titlePath);

    for (const specValue of array(suite.specs)) {
      const spec = object(specValue);
      const title = string(spec?.title);
      const file = string(spec?.file);
      if (!spec || !title || !file) continue;

      for (const testValue of array(spec.tests)) {
        const test = object(testValue);
        if (!test) continue;
        const results = array(test.results)
          .map(object)
          .filter((item): item is JsonObject => !!item);
        const finalResult = results[results.length - 1];

        specs.push({
          testId: string(spec.id),
          attempts: results.map((result) => ({
            retry: number(result.retry),
            status: string(result.status) ?? 'unknown',
            duration: number(result.duration),
            startTime: string(result.startTime),
            error: lastError([result]),
            output: capturedOutput([result]),
            attachments: attachments([result], rootDir),
            steps: array(result.steps).flatMap((value) => {
              const step = object(value);
              const title = string(step?.title);
              return title
                ? [
                    {
                      title,
                      duration: number(step?.duration),
                      error: string(object(step?.error)?.message),
                    },
                  ]
                : [];
            }),
          })),
          title,
          titlePath: [...titlePath, title],
          file: resolvePath(file, rootDir),
          line: Math.max(0, Math.min(0x7ffffffe, Math.floor(number(spec.line, 1)) - 1)),
          status: outcome(test, finalResult),
          duration: results.reduce((total, result) => total + number(result.duration), 0),
          projectName: string(test.projectName),
          error: lastError(results),
          traceFile: lastTrace(results, rootDir),
          tags: array(spec.tags).filter((tag): tag is string => typeof tag === 'string'),
          annotations: annotations(test),
          attachments: attachments(results, rootDir),
          output: capturedOutput(results),
        });
      }
    }
  }
}

export function parseReportJson(raw: string, fallbackRoot: string): TestResults | null {
  try {
    const report = object(JSON.parse(raw));
    if (!report || !Array.isArray(report.suites)) return null;
    const config = object(report.config);
    const metadata = object(object(config?.metadata)?.playwrightStudio);
    const rootDir = string(config?.rootDir) ?? fallbackRoot;
    const specs: SpecResult[] = [];
    flattenSuites(array(report.suites), specs, rootDir);
    const stats = object(report.stats) ?? {};
    const parsedStart = new Date(string(stats.startTime) ?? '');

    return {
      errors: array(report.errors).flatMap((value) => {
        const error = object(value);
        const message = string(error?.message) ?? string(error?.value);
        return message ? [stripTerminalFormatting(message)] : [];
      }),
      evidence:
        metadata && typeof metadata.capturedAt === 'string'
          ? {
              capturedAt: metadata.capturedAt,
              revision: string(metadata.revision),
              workspaceRoot: string(metadata.workspaceRoot),
              environment: object(metadata.environment)
                ? {
                    node: string(object(metadata.environment)?.node) ?? 'unknown',
                    platform: string(object(metadata.environment)?.platform) ?? 'unknown',
                    arch: string(object(metadata.environment)?.arch) ?? 'unknown',
                  }
                : undefined,
              fingerprint: string(metadata.fingerprint),
              dirty: typeof metadata.dirty === 'boolean' ? metadata.dirty : undefined,
            }
          : undefined,
      specs,
      rootDir: string(metadata?.workspaceRoot) ?? rootDir,
      summary: {
        passed: number(stats.expected, specs.filter((spec) => spec.status === 'passed').length),
        failed: number(
          stats.unexpected,
          specs.filter((spec) => spec.status === 'failed' || spec.status === 'timedOut').length,
        ),
        skipped: number(stats.skipped, specs.filter((spec) => spec.status === 'skipped').length),
        flaky: number(stats.flaky, specs.filter((spec) => spec.status === 'flaky').length),
        duration: number(stats.duration),
        startTime: Number.isNaN(parsedStart.getTime()) ? new Date(0) : parsedStart,
      },
    };
  } catch {
    return null;
  }
}
