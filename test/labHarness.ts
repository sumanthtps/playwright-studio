import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { terminateProcessTree } from '../src/processTree';
import { ExperimentWorkspace, sourceFiles, ExecuteProcess } from '../src/intelligence/execution';
import { indexSources } from '../src/intelligence/analysis';
import { LabController, LabHost } from '../src/intelligence/labController';
import { reset } from './vscodeMock';
export const repo = path.resolve(__dirname, '..');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
export function harness(name: string, kind = 'lab-experiments', timeoutMs = 120000) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-' + name + '-')));
  const output = path.join(repo, '.test-dist', kind, name);
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'));
  fs.symlinkSync(
    path.join(repo, 'node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  fs.writeFileSync(
    path.join(root, 'playwright.config.ts'),
    "export default {testDir:'./tests',timeout:10000};",
  );
  fs.writeFileSync(
    path.join(root, 'app.ts'),
    'export function sum(a:number,b:number){return a+b;}',
  );
  fs.writeFileSync(
    path.join(root, 'tests/calc.spec.ts'),
    "import {test,expect} from '@playwright/test';import {sum} from '../app';test('total',()=>{expect(sum(3,2)).toBe(5);});",
  );
  let count = 0;
  const reports: { kind?: string; report: any; data?: any }[] = [];
  const execute: ExecuteProcess = (command, cwd, env) =>
    new Promise((resolve, reject) => {
      const log = path.join(output, `process-${++count}.log`);
      let stopped = false,
        outputBytes = 0;
      const chunks: Buffer[] = [];
      const child = spawn(command.executable, command.args, {
        cwd,
        env: { ...process.env, ...env },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stop = () => {
        if (stopped) return;
        stopped = true;
        void terminateProcessTree(child);
      };
      const timer = setTimeout(stop, timeoutMs);
      const collect = (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= 4 * 1024 * 1024) chunks.push(chunk);
        else stop();
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        fs.writeFileSync(log, Buffer.concat(chunks));
        resolve(stopped ? undefined : (code ?? undefined));
      });
    });
  const host: LabHost = {
    storageRoot: output,
    show: (_root, report) => reports.push({ report }),
    report: (_root, kind, report, data) => {
      reports.push({ kind, report, data });
      fs.writeFileSync(path.join(output, `${kind}.json`), JSON.stringify(data, null, 2));
    },
    latest: () => undefined,
    remember() {},
    chooseTests: async (_root, _many, _prompt, supplied) =>
      supplied ??
      indexSources(await sourceFiles(root)).tests.filter((t) => t.file.startsWith('tests/')),
    experiment: async (_root, _title, work) => {
      const workspace = await ExperimentWorkspace.create(
        root,
        output,
        { executable: process.execPath, args: [cli, 'test'] },
        execute,
      );
      try {
        return await work(workspace, () => false);
      } finally {
        await workspace.dispose();
      }
    },
  };
  reset(root);
  return {
    root,
    output,
    reports,
    host,
    execute,
    controller: new LabController(host),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
