import { buildRunCommand } from '../config';
import { runCommand } from '../terminal';

export async function runTest(testFile: string, testName?: string, line?: number): Promise<void> {
  await runCommand(buildRunCommand(testFile, { testName, line }), { resource: testFile });
}

export async function runFile(testFile: string): Promise<void> {
  await runTest(testFile);
}
