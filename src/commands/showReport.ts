import { runInTerminal } from '../terminal';

export function showReport(): void {
  runInTerminal('npx playwright show-report');
}
