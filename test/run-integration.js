const fs = require('fs');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  // Extension hosts set this flag for their own Electron process. It must not
  // leak into the child VS Code instance launched by the test harness.
  const configuredExecutable = process.env.VSCODE_EXECUTABLE_PATH;
  const requestedVersion = process.env.STUDIO_VSCODE_VERSION;
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.VSCODE_ESM_ENTRYPOINT;
  // When tests are launched from Codex/another extension host, inherited IPC,
  // PID and cache variables can make a new macOS Electron instance abort
  // during AppKit registration before the test extension is loaded.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) delete process.env[key];
  }
  const root = path.resolve(__dirname, '..');
  const fixture = path.join(root, '.vscode-test', 'workspace');
  const secondFixture = path.join(root, '.vscode-test', 'workspace-two');
  const workspaceFile = path.join(root, '.vscode-test', 'integration.code-workspace');
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.rmSync(secondFixture, { recursive: true, force: true });
  fs.mkdirSync(path.join(fixture, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(secondFixture, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(secondFixture, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(fixture, '.vscode', 'settings.json'), JSON.stringify({
    'playwrightSnippets.testCommand': 'node mock-playwright.js',
    'playwrightSnippets.toolCommand': 'node mock-tool.js',
    'playwrightSnippets.reportPath': 'custom-report',
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
  fs.writeFileSync(path.join(fixture, 'tests', 'locators.spec.ts'), `
test('locator quality', async ({ page }) => {
  await page.locator('text=Save').click();
});
`);
  fs.writeFileSync(path.join(fixture, 'app.js'), 'export const covered = true;\n');
  fs.writeFileSync(path.join(fixture, 'coverage-final.json'), JSON.stringify({
    [path.join(fixture, 'app.js')]: {
      path: path.join(fixture, 'app.js'),
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 28 } } },
      s: { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {},
    },
  }));
  fs.writeFileSync(path.join(secondFixture, '.vscode', 'settings.json'), JSON.stringify({
    'playwrightSnippets.testCommand': 'node mock-playwright.js',
    'playwrightSnippets.toolCommand': 'node mock-tool.js',
    'playwrightSnippets.reporter': 'list',
    'playwrightSnippets.captureResults': true,
  }, null, 2));
  fs.writeFileSync(path.join(secondFixture, 'tests', 'third.spec.ts'), `
test('third', async ({ page }) => {
  await page.goto('https://example.com');
});
`);
  fs.writeFileSync(path.join(secondFixture, 'mock-playwright.js'), `
const fs = require('fs');
fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
  config: { rootDir: __dirname },
  suites: [{ specs: [{ title: 'third', file: 'tests/third.spec.ts', line: 2, tests: [{ projectName: 'webkit', status: 'unexpected', results: [{ status: 'failed', duration: 1, error: { message: 'third failed' }, attachments: [] }] }] }] }],
  stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0, duration: 1, startTime: new Date().toISOString() }
}));
`);
  fs.writeFileSync(path.join(secondFixture, 'mock-tool.js'), '');
  fs.writeFileSync(workspaceFile, JSON.stringify({
    folders: [{ path: 'workspace' }, { path: 'workspace-two' }],
    settings: {},
  }, null, 2));
  fs.writeFileSync(path.join(fixture, 'mock-playwright.js'), `
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'last-invocation.json'), JSON.stringify({ argv: process.argv.slice(2) }));
fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
  config: { rootDir: __dirname },
  suites: [{ specs: [
    { title: 'first', file: 'tests/first.spec.ts', line: 2, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 1, error: { message: '\\x1b[31mfirst failed\\x1b[39m' }, attachments: [] }] }] },
    { title: 'second', file: 'tests/second.spec.ts', line: 2, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 1, error: { message: '\\x1b[31msecond failed\\x1b[39m' }, attachments: [] }] }] }
  ] }],
  stats: { expected: 0, unexpected: 2, skipped: 0, flaky: 0, duration: 2, startTime: new Date().toISOString() }
}));
`);
  fs.writeFileSync(path.join(fixture, 'mock-tool.js'), `
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'last-tool-invocation.json'), JSON.stringify({ argv: process.argv.slice(2) }));
`);

  const options = {
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, '.test-dist', 'integration', 'index.js'),
    launchArgs: [workspaceFile, path.join(fixture, 'tests', 'first.spec.ts'), '--disable-extensions'],
  };
  const macExecutable = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  if (requestedVersion) options.version = requestedVersion;
  else if (configuredExecutable) options.vscodeExecutablePath = configuredExecutable;
  else if (process.platform === 'darwin' && fs.existsSync(macExecutable)) {
    options.vscodeExecutablePath = macExecutable;
  }
  await runTests(options);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
