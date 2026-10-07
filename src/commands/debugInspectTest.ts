import { buildDebugCommand } from '../config';
import { debugCommand } from '../terminal';

export async function debugInspectTest(
  testFile: string,
  testName?: string,
  line?: number
): Promise<void> {
  const started = await debugCommand(buildDebugCommand(testFile, { testName, line }), {
    resource: testFile,
    name: 'Debug Playwright with Inspector',
  });
  if (!started) throw new Error('VS Code could not start the Playwright debug session.');
}

export async function debugInspectFile(testFile: string): Promise<void> {
  await debugInspectTest(testFile);
}
