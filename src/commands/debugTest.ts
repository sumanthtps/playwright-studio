import { buildRunCommand } from '../config';
import { debugCommand } from '../terminal';

export async function debugTest(testFile: string, testName?: string, line?: number): Promise<void> {
  const command = buildRunCommand(testFile, { testName, line });
  command.args.push('--headed');
  const started = await debugCommand(command, { resource: testFile });
  if (!started) throw new Error('VS Code could not start the Playwright debug session.');
}

export async function debugFile(testFile: string): Promise<void> {
  return debugTest(testFile);
}
