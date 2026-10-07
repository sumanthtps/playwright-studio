import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import { atomicWriteFile } from './fileSecurity';
import { revisionEvidence } from './intelligence/model';

const output = (chunks: Array<string | Buffer>) =>
  chunks.map((chunk) =>
    typeof chunk === 'string' ? { text: chunk } : { buffer: chunk.toString('base64') },
  );

function stepData(step: TestStep): object {
  return {
    title: step.title,
    category: step.category,
    duration: step.duration,
    error: step.error,
    steps: step.steps.map(stepData),
  };
}

function resultData(result: TestResult): object {
  return {
    retry: result.retry,
    workerIndex: result.workerIndex,
    parallelIndex: result.parallelIndex,
    status: result.status,
    duration: result.duration,
    startTime: result.startTime.toISOString(),
    error: result.error,
    errors: result.errors,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    steps: result.steps.map(stepData),
    attachments: result.attachments.map((attachment) => ({
      ...attachment,
      body: attachment.body?.toString('base64'),
    })),
  };
}

function testData(test: TestCase): object {
  return {
    id: test.id,
    title: test.title,
    file: test.location.file,
    line: test.location.line,
    column: test.location.column,
    tags: test.tags ?? [],
    tests: [
      {
        projectName: test.parent.project()?.name ?? '',
        expectedStatus: test.expectedStatus,
        status: test.outcome(),
        annotations: test.annotations,
        results: test.results.map(resultData),
      },
    ],
  };
}

function suiteData(suite: Suite): object {
  return {
    title: suite.title,
    file: suite.location?.file,
    line: suite.location?.line,
    suites: suite.suites.map(suiteData),
    specs: suite.tests.map(testData),
  };
}

/** Capture through Playwright's public reporter API, independent of its internal bundle layout. */
export default class StudioReporter implements Reporter {
  private config?: FullConfig;
  private suite?: Suite;
  private readonly errors: TestError[] = [];
  private readonly evidence = revisionEvidence(process.cwd());

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  onError(error: TestError): void {
    this.errors.push(error);
  }

  onEnd(result: FullResult): void {
    const file = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    if (!file) return;
    const stats = {
      startTime: result.startTime.toISOString(),
      duration: result.duration,
      expected: 0,
      unexpected: 0,
      skipped: 0,
      flaky: 0,
    };
    for (const test of this.suite?.allTests() ?? []) stats[test.outcome()]++;
    // Project names are stored on each test, not in its source title path.
    const suites = this.suite?.suites.flatMap((project) => project.suites.map(suiteData)) ?? [];
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    atomicWriteFile(
      file,
      JSON.stringify({
        config: {
          rootDir: this.config?.rootDir ?? process.cwd(),
          metadata: { ...this.config?.metadata, playwrightStudio: this.evidence },
        },
        suites,
        errors: this.errors,
        stats,
      }),
    );
  }
}
