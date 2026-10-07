import * as fs from 'fs';
import * as path from 'path';

const CONFIG_NAMES = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map(
  (extension) => `playwright.config.${extension}`,
);

function hasConfig(directory: string): boolean {
  return CONFIG_NAMES.some((name) => fs.existsSync(path.join(directory, name)));
}

/** Find the nearest Playwright project without walking outside this workspace. */
export function detectWorkingDirectory(workspaceRoot: string, resource?: string): string {
  const root = path.resolve(workspaceRoot);
  let current = resource ? path.resolve(resource) : root;
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }
  while (current === root || current.startsWith(`${root}${path.sep}`)) {
    if (hasConfig(current)) return current;
    if (current === root) break;
    current = path.dirname(current);
  }
  const conventional = ['e2e', 'tests', 'playwright']
    .map((name) => path.join(root, name))
    .filter(hasConfig);
  return conventional.length === 1 ? conventional[0] : root;
}
