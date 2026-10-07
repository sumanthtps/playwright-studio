import * as path from 'path';
import { getConfig } from './config';
import { readBoundedFile } from './fileSecurity';

export function parseEnvFile(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = assignment.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = 1;
      for (;;) {
        for (; end < value.length; end++) {
          if (value[end] === '\\') {
            end++;
            continue;
          }
          if (value[end] === quote) break;
        }
        if (end < value.length || i + 1 >= lines.length) break;
        value += '\n' + lines[++i];
      }
      value = value.slice(1, end);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.split('#')[0].trim();
    }
    env[key] = value;
  }
  return env;
}

export function loadConfiguredEnvFile(resource?: string): Record<string, string> {
  const config = getConfig(resource);
  if (!config.envFile) return {};
  const file = path.isAbsolute(config.envFile)
    ? config.envFile
    : path.resolve(config.workingDirectory, config.envFile);
  try {
    return parseEnvFile(readBoundedFile(file, 1024 * 1024).toString('utf8'));
  } catch {
    throw new Error(`Cannot read the configured environment file: ${file}`);
  }
}
