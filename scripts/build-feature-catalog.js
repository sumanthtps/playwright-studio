// Keep the installed Features view and Marketplace Details catalog in sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const groups = require('../src/featureCatalog.json');
const manifest = require('../package.json');
const commands = new Map(manifest.contributes.commands.map((c) => [c.command, c]));
const documented = new Set();
const ids = new Set();
const features = groups.flatMap((group) => group.features);
const start = '<!-- feature-catalog:start -->';
const end = '<!-- feature-catalog:end -->';
const tableCell = (value) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

for (const item of [...groups, ...features]) {
  assert.match(item.id, /^[a-zA-Z][a-zA-Z0-9-]*$/);
  assert.ok(!ids.has(item.id.toLowerCase()), `Duplicate catalog ID: ${item.id}`);
  ids.add(item.id.toLowerCase());
  assert.ok(item.title.trim(), `Missing title: ${item.id}`);
}
for (const feature of features) {
  assert.ok(feature.description.trim(), `Missing description: ${feature.id}`);
  if (!feature.command) continue;
  assert.ok(commands.has(feature.command), `Unknown catalog command: ${feature.command}`);
  assert.equal(
    feature.title,
    commands.get(feature.command).title,
    `Stale title: ${feature.command}`,
  );
  assert.ok(!documented.has(feature.command), `Duplicate command: ${feature.command}`);
  documented.add(feature.command);
}
assert.deepEqual(
  [...commands.keys()].filter((id) => !documented.has(id)),
  [],
  'Commands missing from feature catalog',
);

const intro = `Each of the **${features.length} entries** below has its own description. Open **Playwright Studio → Features** in the sidebar, or run **Playwright Studio: Open Feature Catalog**. Entries include all **${commands.size} commands** and editor integrations; all **338 snippets** are listed in the [snippet reference](README_PATH#snippets-reference).`;
const tables = groups
  .map(
    (group) =>
      `### ${group.title}\n\n| Feature | What it does |\n| --- | --- |\n${group.features.map((feature) => `| [${tableCell(feature.title)}](docs/features.md#${feature.id.toLowerCase()}) | ${tableCell(feature.description)} |`).join('\n')}`,
  )
  .join('\n\n');
const readmeSection = `${start}\n## Features\n\n${intro.replace('README_PATH', '')}\n\n<details>\n<summary>Explore all features and commands</summary>\n\n${tables}\n\n</details>\n${end}`;
const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
assert.ok(readme.includes(start) && readme.includes(end), 'Missing README feature catalog markers');
const updatedReadme =
  readme.slice(0, readme.indexOf(start)) +
  readmeSection +
  readme.slice(readme.indexOf(end) + end.length);
const guide = `# Playwright Studio feature catalog\n\n${intro.replace('README_PATH', '../README.md')}\n\nSelect a feature in the sidebar to open its entry here. To use a command, open the Command Palette and search for its name. Editor commands use your active test file or selection; open that file before running them.\n\n[Setup and troubleshooting](guide.md) · [Intelligence workflows](intelligence.md) · [Advanced workflows](lab.md)\n\n${groups.map((group) => `## ${group.title}\n\n${group.features.map((feature) => `<a id="${feature.id.toLowerCase()}"></a>\n\n### ${feature.title}\n\n${feature.description}\n${feature.command ? `\n**Command:** Playwright Studio: ${feature.title}\n` : ''}`).join('\n')}`).join('\n')}`;
for (const [file, contents] of [
  [readmePath, updatedReadme],
  [path.join(root, 'docs/features.md'), guide],
]) {
  if (process.argv.includes('--check')) {
    assert.equal(
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
      contents,
      `${path.relative(root, file)} is stale. Run npm run docs:features.`,
    );
  } else {
    fs.writeFileSync(file, contents);
  }
}
console.log(`Feature catalog: ${features.length} entries, covering all ${commands.size} commands.`);
