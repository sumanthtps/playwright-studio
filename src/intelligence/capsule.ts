import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import {
  requireArray,
  requireObject,
  requireString,
  relativeFile,
  parseTestReference,
  BranchCondition,
  parseBranch,
} from './labModel';
import { digest, localFile, RevisionEvidence, TestReference } from './model';
import { ExecutionResult } from './execution';
import { readBoundedFile } from '../fileSecurity';

export interface CapsuleFile {
  file: string;
  content: string;
  sha256: string;
}
export interface Capsule {
  version: 1;
  kind: 'playwright-studio-capsule';
  name: string;
  createdAt: string;
  revision: RevisionEvidence;
  runtime: { node: string; platform: string; arch: string; playwright: string; lockHash?: string };
  tests: TestReference[];
  files: CapsuleFile[];
  expectedFailure: string;
  branch?: BranchCondition;
  seed: number;
  notes: string;
}
const omitted = new Set([
  '.git',
  'node_modules',
  '.vscode-test',
  '.test-dist',
  '.next',
  '.turbo',
  'playwright-report',
  'test-results',
  'coverage',
  '.studio-output',
  'capsules',
]);
export function portableFile(file: string): boolean {
  return (
    !file
      .toLowerCase()
      .split('/')
      .some(
        (p) =>
          omitted.has(p) ||
          p.startsWith('.env') ||
          p.startsWith('.studio-') ||
          [
            '.ssh',
            '.aws',
            '.azure',
            '.gcloud',
            '.npmrc',
            '.yarnrc',
            '.netrc',
            '.pypirc',
            '.git-credentials',
            '.docker',
          ].includes(p) ||
          /^(?:\.auth|auth-state|storage-?state|secrets?|credentials|id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:\.|$)/.test(
            p,
          ),
      ) && !/\.(?:pem|key|p12|pfx|vsix|capsule\.json)$/i.test(file)
  );
}
export async function capsuleCandidates(root: string): Promise<string[]> {
  const result: string[] = [];
  let count = 0;
  async function visit(dir: string) {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (++count > 20000) throw new Error('Capsule scan exceeds 20,000 entries.');
      const file = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
      if (!portableFile(file) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) await visit(path.join(dir, e.name));
      else if (
        e.isFile() &&
        (await fs.promises.stat(path.join(dir, e.name))).size <= 4 * 1024 * 1024
      )
        result.push(file);
    }
  }
  await visit(root);
  return result.sort();
}
export function bundleFiles(root: string, files: string[]): CapsuleFile[] {
  let size = 0;
  return files.map((file) => {
    relativeFile(root, file);
    if (!portableFile(file)) throw new Error(`Excluded capsule file: ${file}`);
    const data = readBoundedFile(localFile(root, file), 4 * 1024 * 1024);
    if ((size += data.length) > 32 * 1024 * 1024 || data.length > 4 * 1024 * 1024)
      throw new Error('Capsules support 32 MB total and 4 MB per file.');
    return { file, content: data.toString('base64'), sha256: digest(data) };
  });
}
export function runtimeInfo(root: string): Capsule['runtime'] {
  const requireApp = createRequire(path.join(root, 'package.json'));
  let playwright = 'unavailable';
  try {
    playwright = JSON.parse(
      fs.readFileSync(requireApp.resolve('playwright/package.json'), 'utf8'),
    ).version;
  } catch {
    /* Report as unavailable. */
  }
  const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'].filter((f) =>
    fs.existsSync(path.join(root, f)),
  );
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    playwright,
    lockHash: locks.length
      ? digest(locks.map((f) => f + digest(fs.readFileSync(path.join(root, f)))).join('\n'))
      : undefined,
  };
}
export function failureSignature(result: ExecutionResult): string {
  if (result.outcome !== 'failed') return '';
  return (
    result.report?.specs
      .filter((s) => ['failed', 'timedOut'].includes(s.status))
      .map((s) => {
        const error = (s.error || s.status)
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split('\n')
          .filter((line) => line.trim() && !/^\s*(?:at |\d+\s*\||>\s*\d+\s*\||\^)/.test(line))
          .slice(0, 6)
          .join(' ')
          .replace(/https?:\/\/[^\s]+/g, '<url>')
          .replace(/(?:[A-Za-z]:)?[\\/][^\s)]+/g, '<path>')
          .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<duration>');
        return JSON.stringify([s.title, s.projectName ?? '', error]);
      })
      .sort()
      .join('\n') ?? ''
  );
}
export function parseCapsule(root: string, value: unknown): Capsule {
  const c = requireObject(value);
  if (c.version !== 1 || c.kind !== 'playwright-studio-capsule')
    throw new Error('Unsupported bug capsule.');
  const runtime = requireObject(c.runtime),
    revision = requireObject(c.revision);
  let bytes = 0;
  const files = requireArray(c.files, 'capsule files', 20000).map((value) => {
    const f = requireObject(value),
      file = relativeFile(root, f.file);
    if (!portableFile(file)) throw new Error(`Excluded capsule path: ${file}`);
    if (typeof f.content !== 'string') throw new Error('Invalid capsule encoding.');
    if (f.content.length > 4 * Math.ceil((4 * 1024 * 1024) / 3))
      throw new Error('Capsule exceeds size limits.');
    const data = Buffer.from(f.content, 'base64');
    // Canonical round-trip is linear; repeating base64 regex groups can
    // exhaust the JS regexp stack even for valid multi-megabyte files.
    if (data.toString('base64') !== f.content) throw new Error('Invalid capsule encoding.');
    if (data.length > 4 * 1024 * 1024 || (bytes += data.length) > 32 * 1024 * 1024)
      throw new Error('Capsule exceeds size limits.');
    if (digest(data) !== f.sha256) throw new Error(`Capsule checksum mismatch: ${file}`);
    return { file, content: f.content, sha256: String(f.sha256) };
  });
  const paths = new Set(files.map((f) => f.file.toLowerCase()));
  if (
    paths.size !== files.length ||
    files.some((f) =>
      f.file
        .split('/')
        .slice(0, -1)
        .some((_, i, parts) =>
          paths.has(
            parts
              .slice(0, i + 1)
              .join('/')
              .toLowerCase(),
          ),
        ),
    )
  )
    throw new Error('Duplicate or conflicting capsule paths.');
  const tests = requireArray(c.tests, 'capsule tests', 100).map((t) => parseTestReference(root, t));
  if (
    !tests.length ||
    tests.some((t) => !files.some((f) => f.file === t.file)) ||
    !files.some((f) => /^playwright\.config\.[cm]?[jt]s$/.test(f.file))
  )
    throw new Error('Capsule must contain selected tests and a Playwright config.');
  if (typeof c.seed !== 'number' || !Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff)
    throw new Error('Invalid capsule seed.');
  return {
    version: 1,
    kind: 'playwright-studio-capsule',
    name: requireString(c.name, 'capsule name'),
    createdAt: requireString(c.createdAt, 'creation time'),
    revision: {
      capturedAt: requireString(revision.capturedAt, 'revision time'),
      revision: typeof revision.revision === 'string' ? revision.revision : undefined,
      fingerprint: typeof revision.fingerprint === 'string' ? revision.fingerprint : undefined,
    },
    runtime: {
      node: requireString(runtime.node, 'Node version'),
      platform: requireString(runtime.platform, 'platform'),
      arch: requireString(runtime.arch, 'architecture'),
      playwright: requireString(runtime.playwright, 'Playwright version'),
      lockHash:
        runtime.lockHash === undefined ? undefined : requireString(runtime.lockHash, 'lock hash'),
    },
    files,
    tests,
    expectedFailure: requireString(c.expectedFailure, 'failure signature'),
    seed: c.seed,
    notes: requireString(c.notes, 'notes'),
    branch: c.branch === undefined ? undefined : parseBranch(c.branch),
  };
}
export function runtimeDifferences(a: Capsule['runtime'], b: Capsule['runtime']): string[] {
  return (['node', 'platform', 'arch', 'playwright', 'lockHash'] as const)
    .filter(
      (k) =>
        a[k] !== b[k] ||
        (k === 'playwright' && a[k] === 'unavailable') ||
        (k === 'lockHash' && !a[k]),
    )
    .map((k) => `${k}: captured ${a[k] ?? 'unknown'}, installed ${b[k] ?? 'unknown'}`);
}
/** Read committed blobs without checking out or changing the user's repository. */
export function revisionFiles(
  root: string,
  revision: string,
): { revision: string; files: { file: string; content: Buffer }[] } {
  if (!/^[A-Za-z0-9_./~^@{}-]+$/.test(revision) || revision.startsWith('-'))
    throw new Error('Invalid Git revision.');
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
      timeout: 10000,
      maxBuffer: 40 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const sha = git(['rev-parse', '--verify', `${revision}^{commit}`])
    .toString()
    .trim();
  const prefix = git(['rev-parse', '--show-prefix']).toString().trim();
  const entries = git(['ls-tree', '-r', '-z', sha, '--', '.'])
    .toString()
    .split('\0')
    .filter(Boolean);
  if (entries.length > 20000) throw new Error('Revision exceeds 20,000 entries.');
  const files: { file: string; content: Buffer }[] = [];
  let total = 0;
  for (const entry of entries) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) continue;
    const file = prefix && match[3].startsWith(prefix) ? match[3].slice(prefix.length) : match[3];
    if (!portableFile(file)) continue;
    if (match[1] === '120000') throw new Error('Revision contains a source symlink.');
    relativeFile(root, file);
    const content = git(['cat-file', 'blob', match[2]]);
    if ((total += content.length) > 32 * 1024 * 1024) throw new Error('Revision exceeds 32 MB.');
    files.push({ file, content });
  }
  return { revision: sha, files };
}
