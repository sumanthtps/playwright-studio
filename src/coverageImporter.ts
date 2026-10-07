import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { coverageApi, FileCoverageDetail, BranchCoverage } from './vscodeCompatibility';
import { insideDirectory, readableFileInRoots, readBoundedFile } from './fileSecurity';

interface IstanbulLocation {
  start?: { line?: number; column?: number };
  end?: { line?: number; column?: number };
}

interface IstanbulFile {
  path?: string;
  statementMap?: Record<string, IstanbulLocation>;
  s?: Record<string, number>;
  fnMap?: Record<string, { name?: string; decl?: IstanbulLocation; loc?: IstanbulLocation }>;
  f?: Record<string, number>;
  branchMap?: Record<string, { locations?: IstanbulLocation[] }>;
  b?: Record<string, number[]>;
}

interface V8Range {
  startOffset?: number;
  endOffset?: number;
  count?: number;
}
interface V8Function {
  functionName?: string;
  ranges?: V8Range[];
}
interface V8Script {
  url?: string;
  functions?: V8Function[];
}

export interface ImportedCoverageFile {
  uri: vscode.Uri;
  details: FileCoverageDetail[];
}

function location(value: IstanbulLocation | undefined): vscode.Range {
  const startLine = Math.max(0, (value?.start?.line ?? 1) - 1);
  const startColumn = Math.max(0, value?.start?.column ?? 0);
  const endLine = Math.max(startLine, (value?.end?.line ?? startLine + 1) - 1);
  const endColumn = Math.max(endLine === startLine ? startColumn : 0, value?.end?.column ?? 0);
  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function parseIstanbul(data: Record<string, unknown>, baseDir: string): ImportedCoverageFile[] {
  const files: ImportedCoverageFile[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const file = raw as IstanbulFile;
    if (!file.statementMap || !file.s) continue;
    const filePath = file.path ?? key;
    if (typeof filePath !== 'string') continue;
    const resolved = path.resolve(baseDir, filePath);
    if (
      !insideDirectory(baseDir, resolved) ||
      (fs.existsSync(resolved) && !readableFileInRoots(resolved, [baseDir]))
    )
      continue;
    const details: FileCoverageDetail[] = [];
    const statements = Object.entries(file.statementMap).map(([id, mapped]) => ({
      id,
      range: location(mapped),
    }));
    const rawBranches = Object.entries(file.branchMap ?? {}).flatMap(([branchId, branch]) =>
      (branch.locations ?? []).map((mapped, index) => ({ branchId, index, mapped })),
    );
    if (statements.length * rawBranches.length > 5_000_000)
      throw new Error('Coverage file exceeds the branch analysis limit.');
    // Compute each branch owner once, from the smallest containing range.
    const bySize = [...statements].sort(
      (a, b) =>
        a.range.end.line - a.range.start.line - (b.range.end.line - b.range.start.line) ||
        a.range.end.character -
          a.range.start.character -
          (b.range.end.character - b.range.start.character),
    );
    const branchesByStatement = new Map<string, BranchCoverage[]>();
    for (const { branchId, index, mapped } of rawBranches) {
      const range = location(mapped);
      const owner = bySize.find((statement) => statement.range.contains(range.start));
      if (owner) {
        const branches = branchesByStatement.get(owner.id) ?? [];
        branches.push(
          new coverageApi.BranchCoverage(
            file.b?.[branchId]?.[index] ?? 0,
            range,
            `branch ${index + 1}`,
          ),
        );
        branchesByStatement.set(owner.id, branches);
      }
    }
    for (const [id, mapped] of Object.entries(file.statementMap)) {
      details.push(
        new coverageApi.StatementCoverage(
          file.s[id] ?? 0,
          location(mapped),
          branchesByStatement.get(id) ?? [],
        ),
      );
    }
    for (const [id, mapped] of Object.entries(file.fnMap ?? {})) {
      details.push(
        new coverageApi.DeclarationCoverage(
          mapped.name || `(anonymous ${id})`,
          file.f?.[id] ?? 0,
          location(mapped.decl ?? mapped.loc),
        ),
      );
    }
    files.push({ uri: vscode.Uri.file(resolved), details });
  }
  return files;
}

function offsetPosition(source: string, offset: number): vscode.Position {
  const safe = Math.max(0, Math.min(offset, source.length));
  const prefix = source.slice(0, safe);
  const lines = prefix.split('\n');
  return new vscode.Position(lines.length - 1, lines.at(-1)?.length ?? 0);
}

function parseV8(scripts: V8Script[], baseDir: string): ImportedCoverageFile[] {
  const files: ImportedCoverageFile[] = [];
  for (const script of scripts) {
    if (!script.url || script.url.startsWith('node:') || script.url.startsWith('webpack:'))
      continue;
    let uri: vscode.Uri;
    try {
      uri = script.url.startsWith('file:')
        ? vscode.Uri.parse(script.url)
        : vscode.Uri.file(
            path.isAbsolute(script.url) ? script.url : path.resolve(baseDir, script.url),
          );
    } catch {
      continue;
    }
    const sourceFile = readableFileInRoots(uri.fsPath, [baseDir]);
    if (!sourceFile) continue;
    let source: string;
    try {
      source = readBoundedFile(sourceFile, 8 * 1024 * 1024).toString('utf8');
    } catch {
      continue;
    }
    const details: FileCoverageDetail[] = [];
    for (const [functionIndex, fn] of (script.functions ?? []).entries()) {
      const ranges = fn.ranges ?? [];
      const outer = ranges[0];
      if (outer?.startOffset !== undefined && outer.endOffset !== undefined) {
        details.push(
          new coverageApi.DeclarationCoverage(
            fn.functionName || `(anonymous ${functionIndex})`,
            outer.count ?? 0,
            new vscode.Range(
              offsetPosition(source, outer.startOffset),
              offsetPosition(source, outer.endOffset),
            ),
          ),
        );
      }
      for (const range of ranges) {
        if (range.startOffset === undefined || range.endOffset === undefined) continue;
        details.push(
          new coverageApi.StatementCoverage(
            range.count ?? 0,
            new vscode.Range(
              offsetPosition(source, range.startOffset),
              offsetPosition(source, range.endOffset),
            ),
          ),
        );
      }
    }
    if (details.length) files.push({ uri, details });
  }
  return files;
}

export function parseCoverageJson(raw: string, baseDir: string): ImportedCoverageFile[] {
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024)
    throw new Error('Coverage report exceeds the 64 MB size limit.');
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    const files = parseV8(parsed as V8Script[], baseDir);
    if (!files.length)
      throw new Error('The V8 report did not contain coverage for readable local files.');
    return files;
  }
  if (!parsed || typeof parsed !== 'object')
    throw new Error('Coverage JSON must contain an object or V8 script array.');
  const object = parsed as Record<string, unknown>;
  if (Array.isArray(object.result)) {
    const files = parseV8(object.result as V8Script[], baseDir);
    if (!files.length)
      throw new Error('The V8 report did not contain coverage for readable local files.');
    return files;
  }
  const istanbul = parseIstanbul(object, baseDir);
  if (!istanbul.length) throw new Error('No Istanbul or V8 coverage entries were found.');
  return istanbul;
}
