// TypeScript 7 supplies the build compiler; the stable AST API lives in this package.
import * as ts from '@typescript/typescript6';
import * as path from 'path';
import type { SpecResult, TestResults } from '../resultParser';
import type { RunRecord } from '../resultStore';
import {
  CoverageLink,
  ProductPromise,
  RevisionEvidence,
  TestReference,
  digest,
  canonicalPath,
} from './model';
export interface SourceFile {
  file: string;
  source: string;
}
export interface SourceTest extends TestReference {
  line: number;
  routes: string[];
  roles: string[];
  steps: string[];
  assertions: string[];
  promises: string[];
}
export interface SourceIndex {
  tests: SourceTest[];
  dependencies: Record<string, string[]>;
  unresolvedImports: string[];
}
export function testKey(test: TestReference): string {
  return JSON.stringify([
    test.file.replace(/\\/g, '/'),
    test.titlePath ?? [test.title],
    test.project ?? '',
  ]);
}
export function referenceFor(spec: SpecResult, root: string): TestReference {
  return {
    file: path.relative(root, spec.file).replace(/\\/g, '/'),
    title: spec.title,
    titlePath: spec.titlePath,
    project: spec.projectName,
  };
}
export function matches(spec: SpecResult, ref: TestReference, root: string): boolean {
  const titleMatches = ref.titlePath?.length
    ? JSON.stringify(spec.titlePath?.slice(-ref.titlePath.length)) === JSON.stringify(ref.titlePath)
    : spec.title === ref.title || spec.titlePath?.join(' › ') === ref.title;
  return (
    canonicalPath(spec.file) === canonicalPath(path.resolve(root, ref.file)) &&
    !!titleMatches &&
    (!ref.project || spec.projectName === ref.project)
  );
}
function tree(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(
    file.file,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file.file)
      ? ts.ScriptKind.TSX
      : /\.jsx$/.test(file.file)
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.TS,
  );
}
function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
export function indexSources(files: SourceFile[]): SourceIndex {
  const known = new Set(files.map((f) => f.file.replace(/\\/g, '/')));
  const index: SourceIndex = { tests: [], dependencies: {}, unresolvedImports: [] };
  for (const file of files) {
    const ast = tree(file);
    const dependencies = new Set<string>();
    walk(ast, (node) => {
      const imported =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? literal(node.moduleSpecifier)
          : ts.isCallExpression(node) &&
              (node.expression.getText(ast) === 'require' ||
                node.expression.kind === ts.SyntaxKind.ImportKeyword)
            ? literal(node.arguments[0])
            : undefined;
      if (imported) {
        if (imported.startsWith('.')) {
          const base = path.posix.normalize(
            path.posix.join(path.posix.dirname(file.file), imported),
          );
          const withoutJs = base.replace(/\.[cm]?jsx?$/, '');
          const candidates = [
            base,
            ...[
              '.ts',
              '.tsx',
              '.js',
              '.jsx',
              '.mts',
              '.cts',
              '/index.ts',
              '/index.tsx',
              '/index.js',
            ].flatMap((ext) => [base + ext, withoutJs + ext]),
          ];
          const resolved = candidates.find((f) => known.has(f));
          if (resolved) dependencies.add(resolved);
          else index.unresolvedImports.push(`${file.file}: ${imported}`);
        } else if (imported.startsWith('@/') || imported.startsWith('~/'))
          index.unresolvedImports.push(`${file.file}: ${imported}`);
      }
      if (!ts.isCallExpression(node)) return;
      const expression = node.expression.getText(ast);
      if (!/^(?:test|it)(?:\.(?:only|skip|fixme|fail))?$/.test(expression)) return;
      const title = literal(node.arguments[0]);
      if (!title) return;
      const callback = node.arguments.find(
        (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
      );
      if (!callback) return;
      const test: SourceTest = {
        file: file.file,
        title,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line,
        routes: [],
        roles: [],
        steps: [],
        assertions: [],
        promises: [],
      };
      const ancestors: string[] = [];
      let parent: ts.Node | undefined = node.parent;
      while (parent) {
        if (
          ts.isCallExpression(parent) &&
          /^(?:test\.)?describe(?:\.(?:only|skip|serial|parallel))*$/.test(
            parent.expression.getText(ast),
          )
        ) {
          const suite = literal(parent.arguments[0]);
          if (suite) ancestors.unshift(suite);
        }
        parent = parent.parent;
      }
      test.titlePath = [...ancestors, title];
      walk(callback, (child) => {
        if (!ts.isCallExpression(child)) return;
        const call = child.expression.getText(ast);
        const first = literal(child.arguments[0]);
        if (/\.goto$/.test(call) && first) test.routes.push(first);
        if (/\.getByRole$/.test(call) && first) test.roles.push(first);
        if (call === 'test.step' && first) test.steps.push(first);
        if (call.startsWith('expect(') || call.startsWith('expect.soft('))
          test.assertions.push(child.getText(ast));
      });
      const testText = node.getFullText(ast);
      test.promises = [...testText.matchAll(/@promise:([\w-]+)/g)].map((m) => m[1]);
      test.assertions = [...new Set(test.assertions)];
      index.tests.push(test);
    });
    index.dependencies[file.file] = [...dependencies];
  }
  return index;
}
export interface Mutation {
  id: string;
  file: string;
  line: number;
  start: number;
  end: number;
  before: string;
  after: string;
  description: string;
  sourceHash?: string;
}
export function mutationCandidates(file: SourceFile, limit = 30): Mutation[] {
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file.file)) return [];
  const ast = tree(file);
  const result: Mutation[] = [];
  const add = (node: ts.Node, after: string, description: string) => {
    const start = node.getStart(ast),
      end = node.getEnd(),
      before = file.source.slice(start, end);
    if (result.length < limit)
      result.push({
        id: digest(file.file + start + after).slice(0, 12),
        file: file.file,
        line: ast.getLineAndCharacterOfPosition(start).line,
        start,
        end,
        before,
        after,
        description,
        sourceHash: digest(file.source),
      });
  };
  walk(ast, (node) => {
    if (ts.isBinaryExpression(node)) {
      const replacements: Record<string, string> = {
        '===': '!==',
        '!==': '===',
        '>': '<=',
        '>=': '<',
        '<': '>=',
        '<=': '>',
        '+': '-',
        '-': '+',
        '&&': '||',
        '||': '&&',
      };
      const op = node.operatorToken.getText(ast);
      if (replacements[op])
        add(node.operatorToken, replacements[op], `Replace ${op} with ${replacements[op]}`);
    } else if (
      ts.isReturnStatement(node) &&
      node.expression &&
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.expression.kind)
    ) {
      add(
        node.expression,
        node.expression.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true',
        'Invert boolean return',
      );
    }
  });
  return result;
}
export function applyMutation(source: string, mutation: Mutation): string {
  if (source.slice(mutation.start, mutation.end) !== mutation.before)
    throw new Error('Source changed since mutation discovery.');
  return source.slice(0, mutation.start) + mutation.after + source.slice(mutation.end);
}
export interface RepairAudit {
  removedAssertions: string[];
  addedSkips: string[];
  timeoutChanges: string[];
  changes: number;
}
export function auditRepair(before: SourceFile, after: SourceFile): RepairAudit {
  const collect = (file: SourceFile) => {
    const ast = tree(file);
    const assertions: string[] = [],
      skips: string[] = [],
      timeouts: string[] = [];
    walk(ast, (node) => {
      if (!ts.isCallExpression(node)) return;
      const name = node.expression.getText(ast);
      if (/^expect(?:\.soft)?\(/.test(name))
        assertions.push(node.getText(ast).replace(/\s+/g, ' '));
      if (/\.(skip|fixme|fail|only)$/.test(name)) skips.push(node.getText(ast));
      if (/\.(setTimeout|slow|waitForTimeout)$/.test(name) || /timeout\s*:/.test(node.getText(ast)))
        timeouts.push(node.getText(ast));
    });
    return { assertions, skips, timeouts };
  };
  const a = collect(before),
    b = collect(after);
  return {
    removedAssertions: a.assertions.filter((x) => !b.assertions.includes(x)),
    addedSkips: b.skips.filter((x) => !a.skips.includes(x)),
    timeoutChanges: b.timeouts.filter((x) => !a.timeouts.includes(x)),
    changes: before.source === after.source ? 0 : 1,
  };
}
function signature(spec: SpecResult): string {
  return (spec.error || spec.attempts?.find((a) => a.error)?.error || spec.status)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((s) => s.trim() && !/^\s+at /.test(s))
    .slice(0, 3)
    .join(' ')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)?\b/g, '#')
    .slice(0, 500);
}
export function investigate(latest: TestResults, history: readonly RunRecord[]) {
  const failures = latest.specs.filter((s) => ['failed', 'timedOut', 'flaky'].includes(s.status));
  const clusters = new Map<string, SpecResult[]>();
  failures.forEach((spec) => {
    const key = signature(spec);
    clusters.set(key, [...(clusters.get(key) ?? []), spec]);
  });
  return [...clusters].map(([symptom, specs]) => ({
    symptom,
    count: specs.length,
    classification: 'Shared symptom; cause not yet confirmed',
    tests: specs.map((spec) => {
      const previous = history
        .filter(
          (r) =>
            path.resolve(r.rootDir) === path.resolve(latest.rootDir) &&
            r.summary.startTime < latest.summary.startTime,
        )
        .sort((a, b) => b.summary.startTime.getTime() - a.summary.startTime.getTime())
        .find((r) =>
          r.specs.some(
            (s) =>
              matches(s, referenceFor(spec, latest.rootDir), latest.rootDir) &&
              s.status === 'passed',
          ),
        );
      const passing = previous?.specs.find(
        (s) =>
          matches(s, referenceFor(spec, latest.rootDir), latest.rootDir) && s.status === 'passed',
      );
      const attempts = spec.attempts ?? [];
      return {
        test: referenceFor(spec, latest.rootDir),
        status: spec.status,
        error: spec.error,
        attempts,
        trace: spec.traceFile,
        passingBaseline:
          previous && passing
            ? {
                run: previous.id,
                revision: previous.evidence?.revision,
                duration: passing.duration,
                output: passing.output,
                trace: passing.traceFile,
              }
            : undefined,
        durationChangeMs: passing ? spec.duration - passing.duration : undefined,
        output: spec.output,
        experiment: /401|403|auth|session/i.test(spec.error ?? '')
          ? 'Repeat with fresh authentication, then explicitly expire it; compare the failing request.'
          : /timeout|timed out/i.test(spec.error ?? '')
            ? 'Repeat with one worker and trace enabled; compare the earliest divergent step.'
            : 'Repeat the same test and project against the previous passing revision; compare the assertion inputs.',
      };
    }),
  }));
}
export function planImpact(
  index: SourceIndex,
  changed: string[],
  links: CoverageLink[],
  history: readonly RunRecord[],
  root: string,
  revision: RevisionEvidence,
  budgetMs: number,
  promises: ProductPromise[],
) {
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, deps] of Object.entries(index.dependencies))
      if (!affected.has(file) && deps.some((d) => affected.has(d))) {
        affected.add(file);
        grew = true;
      }
  }
  const ranked = index.tests
    .map((test) => {
      const reasons: string[] = [];
      if (changed.includes(test.file)) reasons.push('Test file changed');
      else if (affected.has(test.file))
        reasons.push('Imports changed code, directly or transitively');
      const coverage = links.filter(
        (link) =>
          link.test.file === test.file &&
          link.test.title === test.title &&
          link.files.some((file) => changed.includes(file)),
      );
      if (coverage.length)
        reasons.push(
          coverage.some((c) => c.revision === revision.revision && !revision.dirty)
            ? 'Per-test coverage intersects changed code'
            : 'Historical coverage intersects changed code (needs refreshing)',
        );
      const runs = history
        .filter((r) => path.resolve(r.rootDir) === path.resolve(root))
        .flatMap((r) => r.specs.filter((s) => matches(s, test, root)))
        .slice(0, 20);
      if (runs.some((s) => ['failed', 'flaky', 'timedOut'].includes(s.status)))
        reasons.push('Recent failure or flakiness');
      if (
        promises.some(
          (p) =>
            p.priority === 'critical' &&
            p.tests.some((t) => t.file === test.file && t.title === test.title),
        )
      )
        reasons.push('Protects a critical product promise');
      const estimatedMs = runs.length
        ? Math.max(1000, Math.ceil(runs.reduce((sum, s) => sum + s.duration, 0) / runs.length))
        : 30000;
      const score =
        (affected.has(test.file) ? 100 : 0) + (coverage.length ? 90 : 0) + reasons.length * 10;
      return { ...test, reasons, estimatedMs, score, estimated: runs.length === 0 };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.estimatedMs - b.estimatedMs || testKey(a).localeCompare(testKey(b)),
    );
  let remaining = budgetMs;
  const selected = ranked.filter((test) => {
    if (!test.score || test.estimatedMs > remaining) return false;
    remaining -= test.estimatedMs;
    return true;
  });
  return {
    changed,
    selected,
    omitted: ranked.filter((test) => !selected.includes(test)),
    estimatedMs: budgetMs - remaining,
    budgetMs,
    unresolvedImports: index.unresolvedImports,
    uncoveredChanges: changed.filter(
      (file) =>
        !index.tests.some((t) => t.file === file) &&
        !links.some((l) => l.files.includes(file)) &&
        !Object.values(index.dependencies).some((deps) => deps.includes(file)),
    ),
    note: 'Budget is an estimate excluding setup and browser startup. Omitted tests remain unverified; import analysis cannot infer browser-to-server dependencies.',
  };
}
export function promiseEvidence(
  promises: ProductPromise[],
  history: readonly RunRecord[],
  root: string,
  current: RevisionEvidence,
  now = Date.now(),
) {
  return promises.map((promise) => ({
    ...promise,
    evidence: promise.tests.map((ref) => {
      const run = history
        .filter((r) => path.resolve(r.rootDir) === path.resolve(root))
        .sort((a, b) => b.summary.startTime.getTime() - a.summary.startTime.getTime())
        .find((r) => r.specs.some((s) => matches(s, ref, root)));
      const specs = run?.specs.filter((s) => matches(s, ref, root)) ?? [];
      const fresh = !!run && now - run.summary.startTime.getTime() <= promise.maxAgeDays * 86400000;
      const sameRevision =
        !!current.fingerprint && current.fingerprint === run?.evidence?.fingerprint;
      const status = !specs.length
        ? 'missing'
        : specs.some((s) => ['failed', 'timedOut'].includes(s.status))
          ? 'failed'
          : specs.some(
                (s) => s.status !== 'passed' || s.attempts?.some((a) => a.status !== 'passed'),
              ) || !!run?.errors?.length
            ? 'incomplete'
            : !fresh
              ? 'stale'
              : !sameRevision
                ? 'different-or-unknown-revision'
                : 'supported';
      return {
        test: ref,
        status,
        run: run?.id,
        lastRun: run?.summary.startTime,
        revision: run?.evidence?.revision,
      };
    }),
  }));
}
/** Redirect imported Playwright fixtures in an isolated copy; source files stay unchanged. */
export function instrumentScenario(file: SourceFile, fixturePath: string): string {
  const ast = tree(file);
  const edits: {
    start: number;
    end: number;
  }[] = [];
  walk(ast, (node) => {
    if (!ts.isStringLiteral(node) || node.text !== '@playwright/test') return;
    const parent = node.parent;
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      (ts.isCallExpression(parent) &&
        (parent.expression.getText(ast) === 'require' ||
          parent.expression.kind === ts.SyntaxKind.ImportKeyword))
    )
      edits.push({ start: node.getStart(ast), end: node.getEnd() });
  });
  let source = file.source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + JSON.stringify(fixturePath) + source.slice(edit.end);
  return source;
}
