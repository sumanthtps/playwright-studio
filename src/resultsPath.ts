import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

const RESULTS_PREFIX = 'playwright-studio-results';
let baseDir: string | undefined;

export function setResultsBaseDir(dir: string): void {
  baseDir = dir;
}

export function getResultsBaseDir(): string {
  return baseDir ?? os.tmpdir();
}

export function getResultsFilePath(workspaceRoot?: string): string {
  return path.join(getResultsBaseDir(), getResultsFileName(workspaceRoot));
}

export function getResultsFileName(workspaceRoot?: string): string {
  if (!workspaceRoot) return `${RESULTS_PREFIX}.json`;
  const key = createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 16);
  return `${RESULTS_PREFIX}-${key}.json`;
}

export function isResultsFileName(name: string): boolean {
  return (
    name === `${RESULTS_PREFIX}.json` ||
    (name.startsWith(`${RESULTS_PREFIX}-`) && name.endsWith('.json'))
  );
}
