import { it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { harness } from './labHarness';
import { state, Uri, window, editor } from './vscodeMock';
import { LabStorage } from '../src/intelligence/labModel';
import { mutationCandidates } from '../src/intelligence/analysis';

it('timed-out test processes cannot leave detached server children running', async () => {
  const h = harness('process-cleanup', 'lab-experiments', 1500);
  try {
    fs.writeFileSync(
      path.join(h.root, 'hang.cjs'),
      `const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:process.platform!=='win32',stdio:'ignore'});require('fs').writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000);`,
    );
    assert.equal(
      await h.execute(
        { executable: process.execPath, args: ['hang.cjs'] },
        h.root,
        {},
        'Timeout cleanup',
      ),
      undefined,
    );
    const pid = Number(fs.readFileSync(path.join(h.root, 'child.pid'), 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt++) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, 'Detached child should terminate with its test runner.');
  } finally {
    h.cleanup();
  }
});

it('Bug Capsules capture and replay reviewed sources even after the local application changes', async () => {
  const h = harness('capsules');
  try {
    const testFile = path.join(h.root, 'tests/calc.spec.ts');
    fs.writeFileSync(testFile, fs.readFileSync(testFile, 'utf8').replace('toBe(5)', 'toBe(7)'));
    state.picks.push((items: any[]) => items, 0);
    state.inputs.push('sum failure', 'No external services; synthetic inputs');
    state.save = Uri.file(path.join(h.output, 'failure.capsule.json'));
    await h.controller.handle(h.root, 'createBugCapsule');
    assert.ok(fs.existsSync(state.save.fsPath), JSON.stringify(h.reports.at(-1)));
    fs.writeFileSync(path.join(h.root, 'app.ts'), 'export function sum(){return 7;}');
    await h.controller.handle(h.root, 'replayBugCapsule');
    assert.equal(h.reports.at(-1)?.data.reproduced, true, JSON.stringify(h.reports.at(-1)));
    assert.match(fs.readFileSync(path.join(h.root, 'app.ts'), 'utf8'), /return 7/);
    const manifest = JSON.parse(fs.readFileSync(state.save.fsPath, 'utf8'));
    assert.ok(manifest.files.every((f: any) => !f.file.includes('node_modules')));
    assert.notEqual(
      h.reports.at(-1)?.data.result.report.evidence.fingerprint,
      manifest.revision.fingerprint,
    );
  } finally {
    h.cleanup();
  }
});
it('Repair Challenges run the original, candidate repetitions and real negative controls without applying edits', async () => {
  const h = harness('repair-challenges');
  try {
    const file = path.join(h.root, 'tests/calc.spec.ts'),
      good = fs.readFileSync(file, 'utf8');
    const original = good.replace('toBe(5)', 'toBe(7)');
    fs.writeFileSync(file, original);
    const candidate = path.join(h.root, 'candidate.ts');
    fs.writeFileSync(candidate, good);
    window.activeTextEditor = editor(file, original);
    state.open = [Uri.file(candidate)];
    state.picks.push((items: any[]) => [items.find((i) => i.control.file === 'app.ts')]);
    await h.controller.handle(h.root, 'challengeRepair');
    const evidence = h.reports.at(-1)?.data;
    assert.equal(evidence.baseline.outcome, 'failed');
    assert.equal(evidence.candidate.outcome, 'passed');
    assert.equal(evidence.candidate.report.specs.length, 3);
    assert.equal(evidence.controls[0].result.outcome, 'failed');
    assert.match(evidence.verdict, /review/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally {
    h.cleanup();
  }
});
it('Incident Memory validates a regression against its recorded broken expression', async () => {
  const h = harness('incident-memory');
  try {
    const storage = new LabStorage(h.root, h.output),
      config = storage.read();
    config.incidents.push({
      id: 'sum',
      title: 'Wrong total',
      summary: 'Addition regressed',
      owner: 'checkout',
      files: ['app.ts'],
      tests: [{ file: 'tests/calc.spec.ts', title: 'total' }],
      control: mutationCandidates({
        file: 'app.ts',
        source: fs.readFileSync(path.join(h.root, 'app.ts'), 'utf8'),
      })[0],
    });
    storage.write(config);
    state.picks.push(0);
    await h.controller.handle(h.root, 'runIncident');
    const evidence = h.reports.at(-1)?.data;
    assert.equal(evidence.baseline.outcome, 'passed');
    assert.equal(evidence.control.outcome, 'failed');
    assert.equal(evidence.verdict, 'Regression detects the recorded defect');
    assert.match(fs.readFileSync(path.join(h.root, 'app.ts'), 'utf8'), /return a\+b/);
  } finally {
    h.cleanup();
  }
});
