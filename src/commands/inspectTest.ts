import { buildInspectArgs } from '../config';
import { runInTerminal } from '../terminal';

export function inspectTest(testFile: string, testName: string): void {
  const args = buildInspectArgs(testFile, testName);
  args.push('--debug');
  runInTerminal(args.join(' '));
}

export function inspectFile(testFile: string): void {
  const args = buildInspectArgs(testFile);
  runInTerminal(args.join(' '), { PWDEBUG: '1' });
}
