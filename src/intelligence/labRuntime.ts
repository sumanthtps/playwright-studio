import * as path from 'path';
import { randomUUID } from 'crypto';
import { ExperimentWorkspace, ExecutionResult, sourceFiles } from './execution';
import {
  instrumentScenario,
  testKey,
  referenceFor,
  Mutation,
  applyMutation,
  auditRepair,
} from './analysis';
import { BranchCondition, LawCase, ProductLaw } from './labModel';
import { TestAttachment } from '../resultParser';
import { digest, localFile } from './model';
import { readBoundedFile, readableFileInRoots } from '../fileSecurity';

export function labFixture(): string {
  return `// Playwright Studio lab runtime
import { test as base } from '@playwright/test';
export * from '@playwright/test';
export const test = base.extend<{studio:any, studioCapture:void}>({
  studio: async ({context}, use, testInfo) => {
    const branch=JSON.parse(process.env.PLAYWRIGHT_STUDIO_BRANCH || 'null');
    let active=!branch?.checkpoint, activated=active, intercepted=0, released=0, orderingTimeouts=0,textObserved=false;
    let release:()=>void=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve});
    const checkpoints:any[]=[];
    const changes=async()=>{
      if(branch?.clearCookies) await context.clearCookies();
      if(branch?.offline) await context.setOffline(true);
      if(branch?.clock) for(const page of context.pages()) await page.clock.install({time:new Date(branch.clock)});
      if(branch?.pageText){
        const inject=(text:string)=>{const add=()=>{if(!document.getElementById('studio-test-content')){const aside=document.createElement('aside');aside.id='studio-test-content';aside.textContent=text;document.body?.appendChild(aside);}};if(document.body)add();else document.addEventListener('DOMContentLoaded',add,{once:true});};
        await context.addInitScript(inject,branch.pageText);
        for(const page of context.pages())await page.evaluate(inject,branch.pageText);
      }
    };
    const response=(response:any)=>{
      if(branch?.releaseAfter && active && response.url().includes(branch.releaseAfter)) {released++;release();}
    };
    context.on('response',response);
    if(branch) await context.route(branch.urlPattern,async route=>{
      if(!active) return route.fallback();
      intercepted++;
      if(branch.releaseAfter){let timer:any;const opened=await Promise.race([gate.then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),5000)})]);clearTimeout(timer);if(!opened){orderingTimeouts++;return route.abort('timedout');}}
      if(branch.latencyMs) await new Promise(resolve=>setTimeout(resolve,branch.latencyMs));
      if(branch.status) await route.fulfill({status:branch.status,contentType:'application/json',body:JSON.stringify({error:'Studio branch: '+branch.name})});
      else await route.fallback();
    });
    if(active) await changes();
    const studio={
      inspect:async()=>{if(branch?.pageText)for(const page of context.pages()){try{textObserved=textObserved||await page.evaluate((text:string)=>document.getElementById('studio-test-content')?.textContent===text,branch.pageText);}catch{}}},
      checkpoint:async(name:string)=>{checkpoints.push({name});if(branch?.checkpoint===name&&!active){active=true;activated=true;await changes();}},
      observe:async(name:string,value:any)=>{await testInfo.attach('studio-observation',{body:Buffer.from(JSON.stringify({name,value})),contentType:'application/json'});},
    };
    try {await use(studio);} finally {
      context.off('response',response);release();
      await studio.inspect();
      await testInfo.attach('studio-branch',{body:Buffer.from(JSON.stringify({branch,activated,intercepted,released,orderingTimeouts,checkpoints,textObserved})),contentType:'application/json'});
    }
  },
  page: async ({page,studio},use)=>{const b=JSON.parse(process.env.PLAYWRIGHT_STUDIO_BRANCH||'null');if(b?.clock&&!b.checkpoint)await page.clock.install({time:new Date(b.clock)});await use(page);},
  studioCapture:[async({studio,page},use,testInfo)=>{
    const requests:any[]=[];
    const onResponse=(r:any)=>{try{const u=new URL(r.url());if(requests.length<200)requests.push({method:r.request().method(),path:u.pathname,status:r.status()});}catch{}};
    page.on('response',onResponse);
    try{await use();}finally{
      await studio.inspect();
      if(process.env.PLAYWRIGHT_STUDIO_OBSERVE==='1'){
        try{
          const snapshot=(await page.locator('body').ariaSnapshot({timeout:3000})).slice(0,100000);
          const focus=await page.evaluate(()=>{const e=document.activeElement;return e?{tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:(e.textContent||'').slice(0,200)}:null;});
          const url=new URL(page.url());
          await testInfo.attach('studio-behavior',{body:Buffer.from(JSON.stringify({version:1,path:url.pathname,aria:snapshot,focus,requests})),contentType:'application/json'});
          await testInfo.attach('studio-behavior-screenshot',{body:await page.screenshot({timeout:3000}),contentType:'image/png'});
        }catch(error){await testInfo.attach('studio-behavior-error',{body:Buffer.from(String(error)),contentType:'text/plain'});}
      }
      page.off('response',onResponse);
    }
  },{auto:true}]
});
`;
}
export async function installLabFixture(workspace: ExperimentWorkspace): Promise<string> {
  const files = await sourceFiles(workspace.root);
  const fixture = `.studio-lab-${randomUUID()}.ts`;
  let count = 0;
  for (const file of files) {
    if (/(?:^|\/)(?:playwright\.config\.|\.studio-)/.test(file.file)) continue;
    if (file.source.startsWith('// Playwright Studio lab runtime')) {
      count++;
      continue;
    }
    let relative = path.posix.relative(path.posix.dirname(file.file), fixture);
    if (!relative.startsWith('.')) relative = './' + relative;
    const source = instrumentScenario(file, relative);
    if (source !== file.source) {
      await workspace.write(file.file, source);
      count++;
    }
  }
  if (!count)
    throw new Error(
      'No @playwright/test imports found. Integrate the exported lab fixture with your test base.',
    );
  await workspace.write(fixture, labFixture());
  return fixture;
}
export function attachmentJson(attachment: TestAttachment, roots: readonly string[] = []): unknown {
  try {
    if (attachment.body) {
      if (attachment.body.length > 2 * 1024 * 1024) return undefined;
      return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    }
    const file = attachment.path && readableFileInRoots(attachment.path, roots);
    if (file) return JSON.parse(readBoundedFile(file, 1024 * 1024).toString('utf8'));
  } catch {
    /* Missing or invalid evidence stays unknown. */
  }
  return undefined;
}
export function attachments(result: ExecutionResult, name: string): unknown[] {
  return (
    result.report?.specs.flatMap((s) =>
      (s.attachments ?? [])
        .filter((a) => a.name === name)
        .map((a) => attachmentJson(a, [path.dirname(result.reportFile)])),
    ) ?? []
  );
}
export function branchEvidence(
  result: ExecutionResult,
  branch: BranchCondition,
): { applied: boolean; reason: string } {
  const values = attachments(result, 'studio-branch') as any[];
  const routing = !!(branch.latencyMs || branch.status || branch.releaseAfter);
  const effect =
    routing || branch.offline || branch.clearCookies || branch.clock || branch.pageText;
  const applied =
    !!effect &&
    values.length > 0 &&
    values.every(
      (v) =>
        v?.branch?.id === branch.id &&
        v.activated &&
        v.orderingTimeouts === 0 &&
        (!routing || v.intercepted > 0) &&
        (!branch.releaseAfter || v.released > 0) &&
        (!branch.pageText || v.textObserved === true),
    );
  return {
    applied,
    reason: applied
      ? 'Configured conditions were observed by the fixture.'
      : 'Missing checkpoint, missing interception, no configured effect, or ordering gate timed out; experiment is inconclusive.',
  };
}
export function lawSpec(adapterImport: string, law: ProductLaw, cases: LawCase[]): string {
  return `import {test,expect} from '@playwright/test';
import * as adapter from ${JSON.stringify(adapterImport)};
test.describe.configure({timeout:180000});
test(${JSON.stringify('Product law: ' + law.id)},async({page,context,request},testInfo)=>{
  test.setTimeout(180000);
  const configured=${JSON.stringify(cases)};
  const cases=process.env.PLAYWRIGHT_STUDIO_LAW_CASE?[JSON.parse(process.env.PLAYWRIGHT_STUDIO_LAW_CASE)]:configured;
  for(const sample of cases){
    const done:string[]=[];let attempted:string|undefined;
    const state=await adapter.setup({page,context,request},sample.seed);
    try{
      await adapter.check(state);
      for(const name of sample.actions){
        if(!Object.prototype.hasOwnProperty.call(adapter.actions,name)||typeof adapter.actions[name]!=='function')throw new Error('Unknown law action: '+name);
        attempted=name;await adapter.actions[name](state);done.push(name);attempted=undefined;await adapter.check(state);
      }
    }catch(error){
      await testInfo.attach('studio-law-failure',{body:Buffer.from(JSON.stringify({lawId:${JSON.stringify(law.id)},seed:sample.seed,actions:done,attempted})),contentType:'application/json'});
      throw error;
    }finally{await adapter.cleanup(state);}
  }
  await testInfo.attach('studio-law-summary',{body:Buffer.from(JSON.stringify({lawId:${JSON.stringify(law.id)},trials:cases.length})),contentType:'application/json'});
});
`;
}
export function lawAdapterTemplate(): string {
  return `// Implement the product law independently of the action implementation.
// setup must reset backend/browser state for every seed; cleanup must release resources.
import {expect} from '@playwright/test';
export async function setup(fixtures:any,seed:number):Promise<any>{
  throw new Error('Implement setup with a reproducible data reset before running this law.');
}
export const actions:Record<string,(state:any)=>Promise<void>>={
  retry:async(state)=>{throw new Error('Implement retry');},
  refresh:async(state)=>{throw new Error('Implement refresh');},
};
export async function check(state:any){throw new Error('Implement an independent invariant assertion');}
export async function cleanup(state:any){}
`;
}
export function compareBehavior(before: ExecutionResult, after: ExecutionResult, root: string) {
  const collect = (result: ExecutionResult) =>
    new Map(
      (result.report?.specs ?? []).map((s) => [
        testKey(referenceFor(s, root)),
        {
          title: s.title,
          project: s.projectName ?? '',
          status: s.status,
          observations: (s.attachments ?? [])
            .filter((a) => ['studio-behavior', 'studio-observation'].includes(a.name))
            .map((a) => ({
              name: a.name,
              value: attachmentJson(a, [path.dirname(result.reportFile)]),
            })),
          artifacts: (s.attachments ?? []).filter(
            (a) => a.name === 'studio-behavior-screenshot' || a.name === 'trace',
          ),
        },
      ]),
    );
  const a = collect(before),
    b = collect(after);
  return [...new Set([...a.keys(), ...b.keys()])].map((key) => {
    const left = a.get(key),
      right = b.get(key);
    const complete =
      !!left &&
      !!right &&
      left.observations.some((o) => o.name === 'studio-behavior' && o.value) &&
      right.observations.some((o) => o.name === 'studio-behavior' && o.value);
    const changes: string[] = [];
    if (!left) changes.push('Test added');
    if (!right) changes.push('Test absent in candidate');
    if (left && right && left.status !== right.status)
      changes.push(`Outcome: ${left.status} → ${right.status}`);
    if (complete && JSON.stringify(left!.observations) !== JSON.stringify(right!.observations))
      changes.push('Runtime observations changed');
    return {
      key,
      title: right?.title ?? left!.title,
      project: right?.project ?? left!.project,
      state: !complete ? 'incomplete evidence' : changes.length ? 'changed' : 'no observed change',
      changes,
      before: left,
      after: right,
    };
  });
}
export interface AgentMetrics {
  model: string;
  completed: boolean;
  forbiddenActions: string[];
  recovered: boolean | null;
  costUsd?: number;
}
export function agentMetrics(result: ExecutionResult, model: string) {
  const specs = result.report?.specs ?? [];
  const observed: AgentMetrics[] = [];
  for (const spec of specs) {
    const values = (spec.attachments ?? [])
      .filter((a) => a.name === 'studio-agent-metrics')
      .map((a) => attachmentJson(a, [path.dirname(result.reportFile)])) as any[];
    if (values.length !== 1) continue;
    const m = values[0];
    if (
      !m ||
      m.model !== model ||
      typeof m.completed !== 'boolean' ||
      !Array.isArray(m.forbiddenActions) ||
      m.forbiddenActions.some((a: unknown) => typeof a !== 'string') ||
      ![true, false, null].includes(m.recovered) ||
      (m.costUsd !== undefined &&
        (typeof m.costUsd !== 'number' || !Number.isFinite(m.costUsd) || m.costUsd < 0))
    )
      continue;
    observed.push(m);
  }
  return {
    attempts: specs.length,
    measured: observed.length,
    completed: observed.filter((m) => m.completed).length,
    forbidden: observed.filter((m) => m.forbiddenActions.length).length,
    recovered: observed.filter((m) => m.recovered === true).length,
    costUsd:
      observed.length && observed.every((m) => m.costUsd !== undefined)
        ? observed.reduce((n, m) => n + m.costUsd!, 0)
        : undefined,
    observations: observed,
  };
}
export async function runControl(
  workspace: ExperimentWorkspace,
  refs: Parameters<ExperimentWorkspace['run']>[1],
  control: Mutation,
) {
  const source = readBoundedFile(localFile(workspace.root, control.file), 4 * 1024 * 1024).toString(
    'utf8',
  );
  if (control.sourceHash && digest(source) !== control.sourceHash)
    throw new Error('Negative-control source changed. Review and select a new control.');
  try {
    await workspace.write(control.file, applyMutation(source, control));
    return await workspace.run(control.description, refs);
  } finally {
    await workspace.write(control.file, source);
  }
}
export function repairVerdict(
  baseline: ExecutionResult,
  candidate: ExecutionResult | undefined,
  controls: ExecutionResult[],
  audit: ReturnType<typeof auditRepair>,
): string {
  if (baseline.outcome !== 'failed' || !candidate || candidate.outcome === 'inconclusive')
    return 'inconclusive';
  if (candidate.outcome !== 'passed') return 'candidate fails';
  if (!controls.length || controls.some((c) => c.outcome === 'inconclusive'))
    return 'inconclusive controls';
  if (controls.some((c) => c.outcome === 'passed')) return 'rejected: a negative control survived';
  if (audit.removedAssertions.length || audit.addedSkips.length || audit.timeoutChanges.length)
    return 'challenges detected; assertion changes require review';
  return 'passed configured challenges';
}
