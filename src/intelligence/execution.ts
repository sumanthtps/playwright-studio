import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { parseReportJson, TestResults } from '../resultParser';
import { CommandInvocation, capturedTestPattern, escapeRegex } from '../commandLine';
import {
  RevisionEvidence,
  Scenario,
  TestReference,
  inside,
  localFile,
  revisionEvidence,
  digest,
} from './model';
import { SourceFile, matches } from './analysis';
import { readBoundedFile } from '../fileSecurity';
const excluded = new Set([
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
]);
export async function sourceFiles(root: string): Promise<SourceFile[]> {
  const result: SourceFile[] = [];
  let visited = 0,
    sourceBytes = 0;
  const visit = async (dir: string) => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (++visited > 20000)
        throw new Error(
          'Workspace scan exceeds 20,000 entries. Open a smaller application folder.',
        );
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.d\.[cm]?ts$/.test(entry.name)
      ) {
        const size = (await fs.promises.stat(file)).size;
        if (size > 1024 * 1024) continue;
        sourceBytes += size;
        if (sourceBytes > 32 * 1024 * 1024)
          throw new Error('Source analysis exceeds 32 MB. Open a smaller application folder.');
        result.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          source: readBoundedFile(file, 1024 * 1024).toString('utf8'),
        });
      }
    }
  };
  await visit(root);
  return result;
}
export async function snapshotWorkspace(root: string, storage = os.tmpdir()): Promise<string> {
  if (inside(root, storage)) throw new Error('Workspace snapshots must be outside the project.');
  await fs.promises.mkdir(storage, { recursive: true });
  const snapshot = await fs.promises.realpath(
    await fs.promises.mkdtemp(path.join(storage, 'playwright-studio-')),
  );
  let bytes = 0,
    count = 0;
  const copy = async (from: string, to: string) => {
    await fs.promises.mkdir(to, { recursive: true });
    for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
      if (excluded.has(entry.name) || /\.vsix$/.test(entry.name)) continue;
      if (++count > 20000)
        throw new Error('Snapshot exceeds 20,000 files. Open a smaller application folder.');
      const source = path.join(from, entry.name),
        destination = path.join(to, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          `Snapshot cannot safely copy source symlink: ${path.relative(root, source)}. Open the resolved application folder.`,
        );
      if (entry.isDirectory()) await copy(source, destination);
      else if (entry.isFile()) {
        bytes += (await fs.promises.stat(source)).size;
        if (bytes > 256 * 1024 * 1024)
          throw new Error('Snapshot exceeds 256 MB. Open a smaller application folder.');
        await fs.promises.copyFile(source, destination);
      }
    }
    const dependencies = path.join(from, 'node_modules');
    if (fs.existsSync(dependencies))
      await fs.promises.symlink(
        dependencies,
        path.join(to, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
  };
  try {
    await copy(root, snapshot);
    if (!fs.existsSync(path.join(snapshot, 'node_modules'))) {
      let dir = path.dirname(root);
      while (dir !== path.dirname(dir)) {
        const modules = path.join(dir, 'node_modules');
        if (fs.existsSync(modules)) {
          await fs.promises.symlink(
            modules,
            path.join(snapshot, 'node_modules'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          break;
        }
        dir = path.dirname(dir);
      }
    }
    return snapshot;
  } catch (error) {
    await fs.promises.rm(snapshot, { recursive: true, force: true });
    throw error;
  }
}
export interface ExecutionResult {
  exitCode?: number;
  report?: TestResults;
  outcome: 'passed' | 'failed' | 'inconclusive';
  reason?: string;
  reportFile: string;
}
export function classifyExecution(
  exitCode: number | undefined,
  report: TestResults | undefined,
  refs: TestReference[],
  root: string,
): Pick<ExecutionResult, 'outcome' | 'reason'> {
  if (exitCode === undefined)
    return {
      outcome: 'inconclusive',
      reason: 'Run cancelled or process did not report an exit code.',
    };
  if (!report || report.errors?.length)
    return {
      outcome: 'inconclusive',
      reason: report?.errors?.join('\n') || 'No valid Playwright report was produced.',
    };
  const selected = refs.length
    ? report.specs.filter((s) => refs.some((r) => matches(s, r, root)))
    : report.specs;
  if (!selected.length || refs.some((r) => !report.specs.some((s) => matches(s, r, root))))
    return { outcome: 'inconclusive', reason: 'One or more selected tests did not execute.' };
  if (selected.some((s) => ['skipped', 'flaky'].includes(s.status)))
    return { outcome: 'inconclusive', reason: 'Selected tests were skipped or flaky.' };
  if (
    selected.some(
      (s) =>
        s.attempts?.some((a) => !['passed', 'failed', 'timedOut'].includes(a.status)) ||
        (s.status === 'passed' && s.attempts?.some((a) => a.status !== 'passed')),
    )
  )
    return {
      outcome: 'inconclusive',
      reason: 'An attempt was interrupted, skipped, or marked as an expected failure.',
    };
  if (exitCode === 0 && selected.every((s) => s.status === 'passed')) return { outcome: 'passed' };
  if (exitCode === 1 && selected.some((s) => ['failed', 'timedOut'].includes(s.status)))
    return { outcome: 'failed' };
  return {
    outcome: 'inconclusive',
    reason: `Unexpected process exit (${exitCode}) or inconsistent report.`,
  };
}
export type ExecuteProcess = (
  command: CommandInvocation,
  cwd: string,
  env: Record<string, string>,
  name: string,
) => Promise<number | undefined>;
export class ExperimentWorkspace {
  private counter = 0;
  private constructor(
    readonly original: string,
    readonly root: string,
    readonly output: string,
    public revision: RevisionEvidence,
    private readonly execute: ExecuteProcess,
    private readonly command: CommandInvocation,
  ) {}
  static async create(
    root: string,
    storage: string,
    command: CommandInvocation,
    execute: ExecuteProcess,
  ): Promise<ExperimentWorkspace> {
    const revision = revisionEvidence(root);
    const snapshot = await snapshotWorkspace(root);
    const output = path.join(storage, 'intelligence-runs', randomUUID());
    try {
      await fs.promises.mkdir(output, { recursive: true });
      const parent = path.dirname(output);
      const directories = (await fs.promises.readdir(parent, { withFileTypes: true })).filter(
        (entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name),
      );
      const dated = await Promise.all(
        directories.map(async (entry) => ({
          file: path.join(parent, entry.name),
          time: (await fs.promises.stat(path.join(parent, entry.name))).mtimeMs,
        })),
      );
      for (const old of dated.sort((a, b) => b.time - a.time).slice(20))
        if (old.file !== output) await fs.promises.rm(old.file, { recursive: true, force: true });
      return new ExperimentWorkspace(root, snapshot, output, revision, execute, command);
    } catch (error) {
      await fs.promises.rm(snapshot, { recursive: true, force: true });
      throw error;
    }
  }
  async write(file: string, source: string | Buffer): Promise<void> {
    const target = localFile(this.root, file);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, source);
  }
  /** Replace only the disposable application copy. Installed dependencies remain linked. */
  async replaceSources(files: { file: string; content: Buffer }[]): Promise<void> {
    for (const entry of files) localFile(this.root, entry.file);
    for (const entry of await fs.promises.readdir(this.root)) {
      if (entry !== 'node_modules')
        await fs.promises.rm(path.join(this.root, entry), { recursive: true, force: true });
    }
    for (const entry of files) await this.write(entry.file, entry.content);
    this.revision = {
      capturedAt: new Date().toISOString(),
      fingerprint: digest(
        files
          .map((f) => f.file + '\0' + digest(f.content))
          .sort()
          .join('\n'),
      ),
      environment: this.revision.environment,
    };
  }
  async run(
    name: string,
    refs: TestReference[] = [],
    extraEnv: Record<string, string> = {},
    repetitions = 1,
  ): Promise<ExecutionResult> {
    const configs = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map(
      (ext) => `playwright.config.${ext}`,
    );
    const config = configs.find((file) => fs.existsSync(path.join(this.root, file)));
    if (!config)
      throw new Error(
        'An application-level playwright.config file is required for isolated experiments.',
      );
    const runDir = path.join(this.output, String(++this.counter));
    await fs.promises.mkdir(runDir);
    const reportFile = path.join(runDir, 'report.json');
    // Import through Playwright's own config loader, preserving project fixtures and test selection.
    const wrapper = path.join(this.root, `.studio-config-${randomUUID()}.ts`);
    const q = JSON.stringify;
    const configSource = `import original from ${q('./' + config)};\nimport path from 'node:path';\nconst root=${q(this.root)}, originalRoot=${q(this.original)};\nconst relocate=(value:string|undefined)=>value&&path.isAbsolute(value)&& (value===originalRoot||value.startsWith(originalRoot+path.sep))?path.join(root,path.relative(originalRoot,value)):value;\nconst servers=original.webServer ? (Array.isArray(original.webServer)?original.webServer:[original.webServer]).map((server:any)=>({...server,cwd:relocate(server.cwd)||root,reuseExistingServer:false})):undefined;\nif(servers?.some((s:any)=>!s.cwd.startsWith(root+path.sep)&&s.cwd!==root)) throw new Error('Web server cwd must be inside the isolated application');\nexport default {...original,metadata:{...original.metadata,playwrightStudio:{...${q(this.revision)},environment:{node:process.version,platform:process.platform,arch:process.arch}}},testDir:relocate(original.testDir),outputDir:${q(path.join(runDir, 'artifacts'))},reporter:[['json',{outputFile:${q(reportFile)}}]],retries:0,repeatEach:${repetitions},forbidOnly:true,webServer:servers,projects:original.projects?.map((p:any)=>({...p,testDir:relocate(p.testDir),outputDir:${q(path.join(runDir, 'artifacts'))},retries:0,repeatEach:${repetitions}}))};\n`;
    await fs.promises.writeFile(wrapper, configSource);
    const args = [
      ...this.command.args,
      '--config',
      wrapper,
      '--workers=1',
      '--retries=0',
      '--repeat-each',
      String(repetitions),
      '--update-snapshots=none',
      '--trace=on',
    ];
    if (refs.length) {
      args.push(
        ...[
          ...new Set(
            refs.map((r) => escapeRegex(localFile(this.root, r.file).replace(/\\/g, '/')) + '$'),
          ),
        ],
      );
      args.push(
        '--grep',
        refs.map((r) => `(?:${capturedTestPattern(r.title, r.titlePath)})`).join('|'),
      );
      const projects = [...new Set(refs.map((r) => r.project).filter((v): v is string => !!v))];
      if (projects.length && refs.every((r) => r.project))
        for (const project of projects) args.push('--project', project);
    }
    const exitCode = await this.execute(
      { executable: this.command.executable, args },
      this.root,
      { PW_TEST_REPORTER: '', PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, ...extraEnv },
      name,
    );
    let report: TestResults | undefined;
    try {
      report =
        parseReportJson(
          readBoundedFile(reportFile, 64 * 1024 * 1024).toString('utf8'),
          this.root,
        ) ?? undefined;
    } catch {
      /* Missing reports are explicitly inconclusive. */
    }
    if (report) {
      report.rootDir = this.original;
      report.specs = report.specs.map((s) => ({
        ...s,
        file: inside(this.root, s.file)
          ? path.join(this.original, path.relative(this.root, s.file))
          : s.file,
      }));
    }
    return {
      exitCode,
      report,
      ...classifyExecution(exitCode, report, refs, this.original),
      reportFile,
    };
  }
  async dispose(): Promise<void> {
    await fs.promises.rm(this.root, { recursive: true, force: true });
  }
}
export function scenarioFixture(): string {
  return `import { test as base } from '@playwright/test';
export * from '@playwright/test';
export const test = base.extend<{ studioScenario: void }>({
  studioScenario: [async ({ context }, use, testInfo) => {
    const s = JSON.parse(process.env.PLAYWRIGHT_STUDIO_SCENARIO || '{}'); let intercepted = 0;
    if(s.offline) await context.setOffline(true);
    if(s.latencyMs || s.status) await context.route(s.urlPattern || '**/*', async route => {
      intercepted++; if(s.latencyMs) await new Promise(resolve=>setTimeout(resolve,s.latencyMs));
      if(s.status) await route.fulfill({status:s.status,contentType:'application/json',body:JSON.stringify({error:'Studio scenario: '+s.name})}); else await route.fallback();
    });
    try { await use(); } finally { await testInfo.attach('studio-scenario', {body:Buffer.from(JSON.stringify({...s,intercepted})),contentType:'application/json'}); }
  }, { auto: true }],
  page: async ({ page }, use) => { const s=JSON.parse(process.env.PLAYWRIGHT_STUDIO_SCENARIO || '{}'); if(s.clock) await page.clock.install({time:new Date(s.clock)}); await use(page); }
});
`;
}
export function scenarioVariants(scenario: Scenario): Scenario[] {
  const variants: Scenario[] = [];
  if (scenario.latencyMs) variants.push({ ...scenario, latencyMs: 0 });
  if (scenario.status) variants.push({ ...scenario, status: undefined });
  if (scenario.offline) variants.push({ ...scenario, offline: false });
  if (scenario.clock) variants.push({ ...scenario, clock: undefined });
  return variants;
}
