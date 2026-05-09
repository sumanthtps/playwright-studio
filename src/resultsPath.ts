import * as os from 'os';
import * as path from 'path';

const RESULTS_FILE = 'playwright-studio-results.json';
let baseDir: string | undefined;

export function setResultsBaseDir(dir: string): void {
  baseDir = dir;
}

export function getResultsBaseDir(): string {
  return baseDir ?? os.tmpdir();
}

export function getResultsFilePath(): string {
  return path.join(getResultsBaseDir(), RESULTS_FILE);
}

export function getResultsFileName(): string {
  return RESULTS_FILE;
}
