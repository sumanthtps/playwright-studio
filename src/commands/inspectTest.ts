import { buildDebugCommand } from '../config';
import { runCommand } from '../terminal';

export async function inspectTest(testFile: string, testName?: string, line?: number): Promise<void> {
  await runCommand(buildDebugCommand(testFile, { testName, line }), {
    resource: testFile,
    name: 'Playwright Inspector',
  });
}

export async function inspectFile(testFile: string): Promise<void> {
  await inspectTest(testFile);
}
