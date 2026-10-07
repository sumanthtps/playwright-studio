import { after, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { studioDirectory, studioFile } from '../src/studioStorage';
import { IntelligenceStorage, emptyConfig } from '../src/intelligence/model';
import { LabStorage, emptyLab } from '../src/intelligence/labModel';

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-storage-tests-')));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
function fixture(name: string) {
  const root = path.join(sandbox, name),
    storage = path.join(sandbox, 'managed');
  fs.mkdirSync(root);
  return { root, storage, legacy: path.join(root, '.playwright-studio') };
}

it('migrates configs and unknown helper files outside Git without changing any ignore files', () => {
  const { root, storage, legacy } = fixture('migration');
  execFileSync('git', ['init', '-q', root]);
  const exclude = fs.readFileSync(path.join(root, '.git/info/exclude'));
  fs.mkdirSync(path.join(legacy, 'helpers'), { recursive: true });
  const config = JSON.stringify(emptyConfig());
  fs.writeFileSync(path.join(legacy, 'studio.json'), config);
  fs.writeFileSync(path.join(legacy, 'lab.json'), JSON.stringify(emptyLab()));
  fs.writeFileSync(path.join(legacy, 'helpers/custom.ts'), 'export const userData = 42;');
  const directory = studioDirectory(root, storage);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(path.join(directory, 'studio.json'), 'utf8'), config);
  assert.equal(
    fs.readFileSync(path.join(directory, 'helpers/custom.ts'), 'utf8'),
    'export const userData = 42;',
  );
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/info/exclude')), exclude);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
  assert.equal(
    execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }),
    '',
  );
  assert.deepEqual(new IntelligenceStorage(root, storage).readConfig(), emptyConfig());
  assert.deepEqual(new LabStorage(root, storage).read(), emptyLab());
  assert.equal(studioDirectory(root, storage), directory);
});

it('stores new config edits locally and isolates projects that have identical names', () => {
  const { root, storage } = fixture('first');
  const second = fixture('second').root;
  const studio = new IntelligenceStorage(root, storage),
    lab = new LabStorage(root, storage);
  const config = emptyConfig();
  config.scenarios.push({
    id: 'slow',
    name: 'Slow',
    urlPattern: '**/api/**',
    latencyMs: 200,
    offline: false,
  });
  studio.writeConfig(config);
  lab.write(emptyLab());
  assert.deepEqual(JSON.parse(JSON.stringify(studio.readConfig())), config);
  assert.equal(fs.existsSync(path.join(root, '.playwright-studio')), false);
  assert.notEqual(studioDirectory(root, storage), studioDirectory(second, storage));
  assert.deepEqual(new IntelligenceStorage(second, storage).readConfig(), emptyConfig());
});

it('preserves both copies on conflicts and resumes safely when identical copies already exist', () => {
  const { root, storage, legacy } = fixture('conflict');
  const directory = studioDirectory(root, storage);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(directory, 'custom.ts'), 'local edits');
  fs.writeFileSync(path.join(legacy, 'custom.ts'), 'workspace edits');
  fs.writeFileSync(path.join(legacy, 'new.ts'), 'keep me');
  assert.throws(() => studioDirectory(root, storage), /conflicting copies/);
  assert.equal(fs.readFileSync(path.join(legacy, 'custom.ts'), 'utf8'), 'workspace edits');
  assert.equal(fs.readFileSync(path.join(directory, 'custom.ts'), 'utf8'), 'local edits');
  assert.equal(fs.existsSync(path.join(legacy, 'new.ts')), true);
  fs.writeFileSync(path.join(directory, 'custom.ts'), 'workspace edits');
  studioDirectory(root, storage);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(path.join(directory, 'new.ts'), 'utf8'), 'keep me');
});

it('rejects symlinks, path traversal and storage inside the repository without deleting data', () => {
  const { root, storage, legacy } = fixture('boundaries');
  const secret = path.join(sandbox, 'secret.txt');
  fs.writeFileSync(secret, 'private');
  fs.mkdirSync(legacy);
  fs.symlinkSync(secret, path.join(legacy, 'link'));
  assert.throws(() => studioDirectory(root, storage), /symlink/);
  assert.equal(fs.lstatSync(path.join(legacy, 'link')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'private');
  fs.unlinkSync(path.join(legacy, 'link'));
  studioDirectory(root, storage);
  assert.throws(() => studioFile(root, '../escape', storage), /escapes/);
  assert.throws(() => studioDirectory(root, path.join(root, 'storage')), /outside the project/);
});

it('migrates an empty legacy folder without creating a new workspace folder', () => {
  const { root, storage, legacy } = fixture('empty');
  fs.mkdirSync(path.join(legacy, 'empty'), { recursive: true });
  studioDirectory(root, storage);
  assert.equal(fs.existsSync(legacy), false);
  assert.deepEqual(fs.readdirSync(root), []);
});
