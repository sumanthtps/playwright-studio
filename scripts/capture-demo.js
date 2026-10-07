// Capture real extension panels while exercising their local browser workflows.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const script of ['test:browser', 'test:selector-browser', 'test:selector-devtools']) {
  execFileSync(process.execPath, [process.env.npm_execpath, 'run', script], {
    cwd: root,
    env: { ...process.env, STUDIO_BROWSER: 'chromium', STUDIO_DEMO: '1' },
    stdio: 'inherit',
  });
}
for (const [source, destination] of Object.entries({
  'selector-intelligence.png': '20-selector-intelligence.png',
  'selector-chrome-devtools.png': '21-chrome-devtools.png',
  'intelligence-dashboard.png': '22-intelligence-dashboard.png',
  'intelligence-scenario.png': '23-scenario-lab.png',
  'intelligence-advanced.png': '24-advanced-workflows.png',
})) {
  fs.copyFileSync(
    path.join(root, '.test-dist', source),
    path.join(root, 'images/demo', destination),
  );
}
console.log('Updated five v2 feature captures. Run npm run demo:gif to assemble the tour.');
