const fs = require('fs');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  // Extension hosts set this flag for their own Electron process. It must not
  // leak into the child VS Code instance launched by the test harness.
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_ESM_ENTRYPOINT;
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(root, '.vscode-test', 'workspace');
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixture, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(fixture, '.vscode', 'settings.json'), JSON.stringify({
    'playwrightSnippets.testCommand': 'node mock-playwright.js',
    'playwrightSnippets.reporter': 'list',
    'playwrightSnippets.captureResults': true,
  }, null, 2));
  fs.writeFileSync(path.join(fixture, 'tests', 'first.spec.ts'), `
test('first', { tag: ['@smoke', '@fast'] }, async ({ page }) => {
  await page.goto('https://example.com');
});

const outside = true;
`);
  fs.writeFileSync(path.join(fixture, 'tests', 'second.spec.ts'), `
test('second', async ({ page }) => {
  await page.goto('https://example.com');
});
`);
  fs.writeFileSync(path.join(fixture, 'mock-playwright.js'), `
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'last-invocation.json'), JSON.stringify({ argv: process.argv.slice(2) }));
fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
  config: { rootDir: __dirname },
  suites: [{ specs: [
    { title: 'first', file: 'tests/first.spec.ts', line: 2, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 1, error: { message: 'first failed' }, attachments: [] }] }] },
    { title: 'second', file: 'tests/second.spec.ts', line: 2, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 1, error: { message: 'second failed' }, attachments: [] }] }] }
  ] }],
  stats: { expected: 0, unexpected: 2, skipped: 0, flaky: 0, duration: 2, startTime: new Date().toISOString() }
}));
`);

  const options = {
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, '.test-dist', 'integration', 'index.js'),
    launchArgs: [fixture, path.join(fixture, 'tests', 'first.spec.ts'), '--disable-extensions'],
  };
  const configuredExecutable = process.env.VSCODE_EXECUTABLE_PATH;
  const macExecutable = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  if (configuredExecutable) options.vscodeExecutablePath = configuredExecutable;
  else if (process.platform === 'darwin' && fs.existsSync(macExecutable)) {
    options.vscodeExecutablePath = macExecutable;
  }
  await runTests(options);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
