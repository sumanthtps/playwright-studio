import { studioFile } from '../studioStorage';
import { getResultsBaseDir } from '../resultsPath';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { localFile, TestReference } from './model';
import { Mutation } from './analysis';
import { readBoundedFile } from '../fileSecurity';

export interface BranchCondition {
  id: string;
  name: string;
  checkpoint?: string;
  urlPattern: string;
  latencyMs: number;
  status?: number;
  releaseAfter?: string;
  offline?: boolean;
  clearCookies?: boolean;
  clock?: string;
  pageText?: string;
}
export interface ProductLaw {
  id: string;
  statement: string;
  adapter: string;
  actions: string[];
  trials: number;
  maxSteps: number;
  seed: number;
}
export interface WindTunnel {
  id: string;
  journeyId: string;
  models: string[];
  branches: string[];
  repetitions: number;
  forbiddenActions: string[];
}
export interface Incident {
  id: string;
  title: string;
  summary: string;
  owner: string;
  files: string[];
  tests: TestReference[];
  lawId?: string;
  capsule?: string;
  control?: Mutation;
}
export interface LabConfig {
  version: 1;
  branches: BranchCondition[];
  laws: ProductLaw[];
  tunnels: WindTunnel[];
  incidents: Incident[];
}
export const emptyLab = (): LabConfig => ({
  version: 1,
  branches: [],
  laws: [],
  tunnels: [],
  incidents: [],
});
export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
export function requireString(value: unknown, label: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Invalid ${label}.`);
  return value;
}
export function requireInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${label}: expected ${min}–${max}.`);
  return value;
}
export function requireArray(value: unknown, label: string, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label} array.`);
  return value;
}
export function relativeFile(root: string, value: unknown): string {
  const file = requireString(value, 'relative file');
  // Use a platform-independent archive/config path convention.
  if (
    /[\\\x00-\x1f<>:"|?*]/.test(file) ||
    file
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[. ]$/.test(p) ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p),
      )
  )
    throw new Error('Use a normalized relative file path without reserved platform names.');
  localFile(root, file);
  return file;
}
export function parseTestReference(root: string, value: unknown): TestReference {
  const v = requireObject(value);
  return {
    file: relativeFile(root, v.file),
    title: requireString(v.title, 'test title'),
    ...(v.titlePath === undefined
      ? {}
      : {
          titlePath: requireArray(v.titlePath, 'title path', 100).map((t) =>
            requireString(t, 'suite title'),
          ),
        }),
    ...(v.project === undefined ? {} : { project: requireString(v.project, 'project') }),
  };
}
export function parseBranch(value: unknown): BranchCondition {
  const v = requireObject(value);
  const b: BranchCondition = {
    id: requireString(v.id, 'branch id', 100),
    name: requireString(v.name, 'branch name'),
    urlPattern: requireString(v.urlPattern, 'URL glob'),
    latencyMs: requireInteger(v.latencyMs, 0, 30000, 'latency'),
  };
  for (const key of ['checkpoint', 'releaseAfter', 'clock', 'pageText'] as const)
    if (v[key] !== undefined) b[key] = requireString(v[key], key);
  for (const key of ['offline', 'clearCookies'] as const)
    if (v[key] !== undefined) {
      if (typeof v[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
      b[key] = v[key];
    }
  if (v.status !== undefined) b.status = requireInteger(v.status, 100, 599, 'HTTP status');
  if (
    b.clock &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(b.clock) ||
      !Number.isFinite(Date.parse(b.clock)))
  )
    throw new Error('Clock needs an ISO date with timezone.');
  return b;
}
export function parseControl(root: string, value: unknown): Mutation {
  const v = requireObject(value);
  const m = {
    id: requireString(v.id, 'control id'),
    file: relativeFile(root, v.file),
    line: requireInteger(v.line, 0, 1000000, 'line'),
    start: requireInteger(v.start, 0, 10000000, 'start'),
    end: requireInteger(v.end, 0, 10000000, 'end'),
    before: requireString(v.before, 'original expression'),
    after: requireString(v.after, 'broken expression'),
    description: requireString(v.description, 'control description'),
  };
  if (
    m.end - m.start !== m.before.length ||
    m.before === m.after ||
    /(?:^|\/)(?:playwright\.config|.*\.(?:spec|test)\.)/.test(m.file)
  )
    throw new Error('Negative control must change an application expression.');
  return {
    ...m,
    ...(v.sourceHash === undefined
      ? {}
      : { sourceHash: requireString(v.sourceHash, 'control source hash') }),
  };
}
export function parseIncident(root: string, value: unknown): Incident {
  const v = requireObject(value);
  const incident: Incident = {
    id: requireString(v.id, 'incident id'),
    title: requireString(v.title, 'title'),
    summary: requireString(v.summary, 'summary'),
    owner: requireString(v.owner, 'owner'),
    files: requireArray(v.files, 'affected files').map((f) => relativeFile(root, f)),
    tests: requireArray(v.tests, 'tests').map((t) => parseTestReference(root, t)),
  };
  if (!incident.files.length || !incident.tests.length)
    throw new Error('Incident needs affected files and regression tests.');
  if (v.lawId !== undefined) incident.lawId = requireString(v.lawId, 'law id');
  if (v.capsule !== undefined) incident.capsule = relativeFile(root, v.capsule);
  if (v.control !== undefined) incident.control = parseControl(root, v.control);
  return incident;
}
export function parseLab(root: string, value: unknown): LabConfig {
  const v = requireObject(value);
  if (v.version !== 1) throw new Error('Unsupported lab configuration version.');
  const branches = requireArray(v.branches, 'branches').map(parseBranch);
  const laws = requireArray(v.laws, 'laws').map((value) => {
    const l = requireObject(value);
    const actions = requireArray(l.actions, 'actions', 100).map((a) =>
      requireString(a, 'action', 100),
    );
    if (!actions.length || new Set(actions).size !== actions.length)
      throw new Error('Law needs distinct action names.');
    return {
      id: requireString(l.id, 'law id', 100),
      statement: requireString(l.statement, 'law statement'),
      adapter: relativeFile(root, l.adapter),
      actions,
      trials: requireInteger(l.trials, 1, 1000, 'trials'),
      maxSteps: requireInteger(l.maxSteps, 1, 100, 'maximum steps'),
      seed: requireInteger(l.seed, 0, 0xffffffff, 'seed'),
    };
  });
  const tunnels = requireArray(v.tunnels, 'tunnels').map((value) => {
    const t = requireObject(value);
    const models = requireArray(t.models, 'models', 5).map((m) => requireString(m, 'model'));
    const ids = requireArray(t.branches, 'tunnel branches', 5).map((b) =>
      requireString(b, 'branch id'),
    );
    const repetitions = requireInteger(t.repetitions, 1, 20, 'repetitions');
    if (
      !models.length ||
      new Set(models).size !== models.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !branches.some((b) => b.id === id)) ||
      models.length * (ids.length + 1) * repetitions > 200
    )
      throw new Error(
        'Tunnel needs distinct models, known branches, and at most 200 total attempts.',
      );
    return {
      id: requireString(t.id, 'tunnel id'),
      journeyId: requireString(t.journeyId, 'journey id'),
      models,
      branches: ids,
      repetitions,
      forbiddenActions: requireArray(t.forbiddenActions, 'forbidden actions', 100).map((a) =>
        requireString(a, 'forbidden action'),
      ),
    };
  });
  const incidents = requireArray(v.incidents, 'incidents').map((i) => parseIncident(root, i));
  for (const entries of [branches, laws, tunnels, incidents])
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new Error('Duplicate lab ids.');
  if (incidents.some((i) => i.lawId && !laws.some((l) => l.id === i.lawId)))
    throw new Error('Incident references an unknown law.');
  return { version: 1, branches, laws, tunnels, incidents };
}
export class LabStorage {
  readonly file: string;
  constructor(
    readonly root: string,
    storageRoot = getResultsBaseDir(),
  ) {
    this.file = studioFile(root, 'lab.json', storageRoot);
  }
  read(): LabConfig {
    return fs.existsSync(this.file)
      ? parseLab(
          this.root,
          JSON.parse(readBoundedFile(this.file, 8 * 1024 * 1024).toString('utf8')),
        )
      : emptyLab();
  }
  write(value: LabConfig): void {
    const content = JSON.stringify(parseLab(this.root, value), null, 2) + '\n';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, content, { flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}

export interface LawCase {
  seed: number;
  actions: string[];
}
export function lawCases(law: ProductLaw): LawCase[] {
  let state = law.seed >>> 0;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  return Array.from({ length: law.trials }, () => ({
    seed: next(),
    actions: Array.from(
      { length: 1 + (next() % law.maxSteps) },
      () => law.actions[next() % law.actions.length],
    ),
  }));
}
/** Deterministic, bounded delta debugging; only retain candidates confirmed by the caller. */
export async function reduceSequence(
  actions: string[],
  preserves: (actions: string[]) => Promise<boolean>,
  cancelled: () => boolean,
  limit = 30,
): Promise<{ actions: string[]; attempts: number }> {
  let current = [...actions],
    attempts = 0,
    granularity = 2;
  while (current.length && attempts < limit && !cancelled()) {
    const size = Math.ceil(current.length / granularity);
    let reduced = false;
    for (let start = 0; start < current.length && attempts < limit && !cancelled(); start += size) {
      const candidate = [...current.slice(0, start), ...current.slice(start + size)];
      attempts++;
      if (await preserves(candidate)) {
        current = candidate;
        granularity = 2;
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(current.length, granularity * 2);
    }
  }
  return { actions: current, attempts };
}
