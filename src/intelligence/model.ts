import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { readBoundedFile } from '../fileSecurity';
import { studioFile } from '../studioStorage';
export interface RevisionEvidence {
  revision?: string;
  dirty?: boolean;
  fingerprint?: string;
  capturedAt: string;
  workspaceRoot?: string;
  environment?: {
    node: string;
    platform: string;
    arch: string;
  };
}
export interface TestReference {
  file: string;
  title: string;
  project?: string;
  titlePath?: string[];
}
export interface ProductPromise {
  id: string;
  statement: string;
  owner: string;
  priority: 'critical' | 'normal';
  tests: TestReference[];
  maxAgeDays: number;
}
export interface Scenario {
  id: string;
  name: string;
  urlPattern: string;
  latencyMs: number;
  status?: number;
  offline: boolean;
  clock?: string;
}
export interface Journey {
  id: string;
  name: string;
  objective: string;
  successCriteria: string[];
  human: TestReference;
  agent: TestReference;
  model: string;
  repetitions: number;
}
export interface CoverageLink {
  test: TestReference;
  files: string[];
  revision: string;
}
export interface StudioConfig {
  version: 1;
  promises: ProductPromise[];
  scenarios: Scenario[];
  journeys: Journey[];
  coverage: CoverageLink[];
}
export interface SavedEvidence {
  version: 1;
  id: string;
  kind: string;
  createdAt: string;
  root: string;
  revision: RevisionEvidence;
  data: unknown;
}
export const emptyConfig = (): StudioConfig => ({
  version: 1,
  promises: [],
  scenarios: [],
  journeys: [],
  coverage: [],
});
export const digest = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');
export function canonicalPath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}
export function inside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export function localFile(root: string, relative: string): string {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative))
    throw new Error('Use a non-empty workspace-relative file path.');
  const file = path.resolve(root, relative);
  if (!inside(root, file)) throw new Error('File path escapes the workspace.');
  let existing = file;
  // existsSync follows links and reports a dangling link as missing. lstat
  // must stop at the link itself so writes cannot follow it out of the root.
  while (true) {
    try {
      fs.lstatSync(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || existing === path.dirname(existing))
        throw error;
      existing = path.dirname(existing);
    }
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(existing);
  } catch {
    throw new Error('File path follows an unresolved link outside the workspace boundary.');
  }
  if (!inside(fs.realpathSync(root), resolved))
    throw new Error('File path follows a link outside the workspace.');
  return file;
}
export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function revisionEvidence(root: string): RevisionEvidence {
  const capturedAt = new Date().toISOString();
  const environment = { node: process.version, platform: process.platform, arch: process.arch };
  try {
    const revision = git(root, ['rev-parse', 'HEAD']).trim();
    const status = git(root, ['status', '--porcelain', '-z', '--untracked-files=normal']);
    const changed = changedFiles(root);
    if (changed.length > 20000) throw new Error('Too many changed files for revision capture.');
    let sourceBytes = 0;
    const fingerprint = digest(
      revision +
        git(root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.']) +
        changed
          .map((file) => {
            try {
              const body = readBoundedFile(localFile(root, file), 32 * 1024 * 1024 - sourceBytes);
              sourceBytes += body.length;
              return file + digest(body);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return file + ':deleted';
              throw error;
            }
          })
          .join('\n'),
    );
    return { revision, dirty: !!status, fingerprint, capturedAt, workspaceRoot: root, environment };
  } catch {
    return { capturedAt, workspaceRoot: root, environment };
  }
}
export function changedFiles(root: string): string[] {
  const prefix = git(root, ['rev-parse', '--show-prefix']).trim();
  const tracked = git(root, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--name-only',
    '-z',
    'HEAD',
    '--',
    '.',
  ])
    .split('\0')
    .filter(Boolean)
    .map((file) => (prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file));
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])
    .split('\0')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])]
    .filter((file) => inside(root, path.resolve(root, file)))
    .sort();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000)
    throw new Error(`Invalid ${label}.`);
  return value;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error(`Invalid ${label} list.`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${label}: expected ${min}–${max}.`);
  return value;
}
function reference(root: string, value: unknown): TestReference {
  const v = object(value);
  const file = text(v.file, 'test file');
  localFile(root, file);
  return {
    file,
    title: text(v.title, 'test title'),
    ...(v.project === undefined ? {} : { project: text(v.project, 'project') }),
    ...(v.titlePath === undefined
      ? {}
      : { titlePath: list(v.titlePath, 'title path').map((part) => text(part, 'suite title')) }),
  };
}
export function validateScenario(value: unknown): Scenario {
  const v = object(value);
  if (typeof v.offline !== 'boolean') throw new Error('Scenario offline must be boolean.');
  const clock = v.clock === undefined || v.clock === '' ? undefined : text(v.clock, 'clock');
  if (
    clock &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(clock) ||
      !Number.isFinite(Date.parse(clock)))
  )
    throw new Error('Clock must be an ISO date with timezone.');
  return {
    id: text(v.id, 'scenario id'),
    name: text(v.name, 'scenario name'),
    urlPattern: text(v.urlPattern, 'URL glob'),
    latencyMs: number(v.latencyMs, 0, 30000, 'latency'),
    offline: v.offline,
    clock,
    status: v.status === undefined ? undefined : number(v.status, 400, 599, 'HTTP error status'),
  };
}
export function parseConfig(root: string, raw: string): StudioConfig {
  const v = object(JSON.parse(raw));
  if (v.version !== 1) throw new Error('Unsupported Studio config version.');
  const promises = list(v.promises, 'promises').map((value) => {
    const p = object(value);
    if (!['critical', 'normal'].includes(String(p.priority)))
      throw new Error('Invalid promise priority.');
    return {
      id: text(p.id, 'promise id'),
      statement: text(p.statement, 'promise statement'),
      owner: text(p.owner, 'owner'),
      priority: p.priority as ProductPromise['priority'],
      maxAgeDays: number(p.maxAgeDays, 1, 3650, 'evidence age'),
      tests: list(p.tests, 'tests').map((t) => reference(root, t)),
    };
  });
  const scenarios = list(v.scenarios, 'scenarios').map(validateScenario);
  const journeys = list(v.journeys, 'journeys').map((value) => {
    const j = object(value);
    const criteria = list(j.successCriteria, 'success criteria').map((c) =>
      text(c, 'success criterion'),
    );
    if (!criteria.length) throw new Error('Journey needs at least one success criterion.');
    return {
      id: text(j.id, 'journey id'),
      name: text(j.name, 'journey name'),
      objective: text(j.objective, 'objective'),
      successCriteria: criteria,
      human: reference(root, j.human),
      agent: reference(root, j.agent),
      model: text(j.model, 'agent model/version'),
      repetitions: number(j.repetitions, 1, 20, 'repetitions'),
    };
  });
  const coverage = list(v.coverage, 'coverage').map((value) => {
    const c = object(value);
    return {
      test: reference(root, c.test),
      revision: text(c.revision, 'coverage revision'),
      files: list(c.files, 'covered files').map((f) => {
        const file = text(f, 'covered file');
        localFile(root, file);
        return file;
      }),
    };
  });
  for (const values of [promises, scenarios, journeys]) {
    const ids = values.map((v) => v.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate ids in Studio config.');
  }
  return { version: 1, promises, scenarios, journeys, coverage };
}
export class IntelligenceStorage {
  constructor(
    readonly root: string,
    private readonly storageRoot: string,
  ) {}
  get configPath(): string {
    return studioFile(this.root, 'studio.json', this.storageRoot);
  }
  readConfig(): StudioConfig {
    return fs.existsSync(this.configPath)
      ? parseConfig(this.root, readBoundedFile(this.configPath, 8 * 1024 * 1024).toString('utf8'))
      : emptyConfig();
  }
  writeConfig(config: StudioConfig): void {
    const raw = JSON.stringify(parseConfig(this.root, JSON.stringify(config)), null, 2) + '\n';
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, raw, { flag: 'wx' });
      fs.renameSync(temporary, this.configPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  save(kind: string, data: unknown): string {
    const dir = path.join(this.storageRoot, 'intelligence', digest(this.root).slice(0, 16));
    fs.mkdirSync(dir, { recursive: true });
    const evidence: SavedEvidence = {
      version: 1,
      id: randomUUID(),
      kind,
      createdAt: new Date().toISOString(),
      root: this.root,
      revision: revisionEvidence(this.root),
      data,
    };
    const file = path.join(dir, `${Date.now()}-${evidence.id}.json`);
    fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d+-[a-f0-9-]+\.json$/.test(f))
      .sort()
      .reverse();
    for (const old of files.slice(100)) fs.unlinkSync(path.join(dir, old));
    return file;
  }
}
