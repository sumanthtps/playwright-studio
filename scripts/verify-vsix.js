// Run after packaging on a host with unzip (Linux/macOS CI).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const file = process.argv[2];
assert.ok(file && fs.existsSync(file), 'Pass a built VSIX path.');
const maxPackageBytes = 1_500_000;
const packageBytes = fs.statSync(file).size;
assert.ok(
  packageBytes <= maxPackageBytes,
  `VSIX is ${packageBytes} bytes, above the ${maxPackageBytes}-byte size budget.`,
);
const unzip = (...args) =>
  execFileSync('unzip', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const entries = unzip('-Z1', file).split('\n');
for (const required of [
  'extension/package.json',
  'extension/changelog.md',
  'extension/docs/licenses/bundled-dependencies.md',
  'extension/dist/extension.js',
  'extension/dist/captureReporter.js',
  'extension/dist/selectorWorker.js',
  'extension/schemas/studio.schema.json',
  'extension/schemas/lab.schema.json',
  'extension/snippets/playwright.json',
  'extension/images/playwright-studio-activity.svg',
  'extension/images/playwright-logo.png',
  'extension/docs/features.md',
  'extension/docs/licenses/typescript-LICENSE.txt',
]) {
  assert.ok(entries.includes(required), `Missing packaged file: ${required}`);
}
assert.ok(
  !entries.some((e) =>
    /^extension\/(?:node_modules|src|test|\.test-dist|\.vscode-test|\.git|\.playwright-studio|playwright-report)\//.test(
      e,
    ),
  ),
  'Development files leaked into the VSIX.',
);
assert.ok(
  !entries.some((e) => /^extension\/images\/(?:preview[^/]*\.gif$|demo\/)/.test(e)),
  'Demo media leaked into the VSIX.',
);
const manifest = JSON.parse(unzip('-p', file, 'extension/package.json'));
const compiled = unzip('-p', file, 'extension/dist/extension.js');
for (const { command } of manifest.contributes.commands) {
  const name = command.slice(command.lastIndexOf('.') + 1);
  assert.ok(compiled.includes(name), `Missing compiled command: ${command}`);
}
for (const schema of ['studio', 'lab'])
  JSON.parse(unzip('-p', file, `extension/schemas/${schema}.schema.json`));
const catalog = unzip('-p', file, 'extension/docs/features.md');
for (const command of manifest.contributes.commands)
  assert.ok(
    catalog.includes(`**Command:** ${command.category}: ${command.title}`),
    `Undocumented packaged command: ${command.command}`,
  );
console.log(
  `Verified ${manifest.contributes.commands.length} command contributions, feature catalog, compiled workflows, reporter, snippets and both schemas in ${file} (${packageBytes} / ${maxPackageBytes} bytes).`,
);
