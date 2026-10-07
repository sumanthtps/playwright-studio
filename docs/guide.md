# Setup and troubleshooting

[Back to README](../README.md)

## Standard projects

Install Playwright in your project, open a test file, and click **Run**. Playwright Studio locates the nearest `playwright.config.ts`, `.js`, `.mts`, `.mjs`, `.cts`, or `.cjs` within the workspace. A single config in a conventional `e2e`, `tests`, or `playwright` folder is also detected.

Result capture is enabled by default. The JSON reporter is added to extension runs at runtime, preserving the reporters in your config. Results and history are stored in VS Code extension storage, outside your repository. You do not need to add the JSON reporter manually.

For a new Playwright project, install `@playwright/test` and the browser binaries required by your tests. **Playwright Studio: Install Playwright Browsers** runs the browser installation command for the selected project.

## Optional settings

| Setting | Use it when |
| --- | --- |
| `playwrightSnippets.workingDirectory` | You want to override automatic detection, or a workspace has several possible projects. Relative paths start at the workspace root. |
| `playwrightSnippets.testCommand` | Your tests use a custom runner. Default: `npx playwright test`. |
| `playwrightSnippets.toolCommand` | Codegen/report/trace commands cannot be derived from a custom test command. Example: `pnpm exec playwright`. |
| `playwrightSnippets.reportPath` | Your HTML reporter writes somewhere other than `playwright-report`. |
| `playwrightSnippets.reporter` | You intentionally want to override the config’s reporters for extension runs. Leave empty to retain them. |
| `playwrightSnippets.captureResults` | You want to disable automatic result capture. Default: `true`. |
| `playwrightSnippets.envFile` | You want to load an environment file before running tests. Relative to the detected/configured working directory. |
| `playwrightSnippets.env` | You need additional environment variables. |
| `playwrightSnippets.envProfiles` | You regularly switch between named environments. |
| `playwrightSnippets.runPresets` | You save run options through **Run with Matrix Options**. |
| `playwrightSnippets.historyLimit` | You want to change the 50-run retention limit per project. |
| `playwrightSnippets.heatmapThresholdDays` | You want to change the seven-day test-recency threshold. This is separate from code coverage. |
| `playwrightSnippets.uiHost` / `uiPort` | You need a specific address for Playwright UI Mode. |
| `playwrightSnippets.componentGalleryUrl` | Your component gallery uses an address other than `http://localhost:3100`. |

Settings apply to the next run. No terminal cleanup or window reload is required.

## Environments and presets

Use **Select .env File** to choose a file, or **Switch Environment Profile** to select a named profile. Precedence is inherited environment → `.env` file → `env` settings → active profile → run-specific overrides. Secret values are not shown in the picker.

```json
{
  "playwrightSnippets.envProfiles": {
    "local": { "BASE_URL": "http://localhost:3000" },
    "staging": { "BASE_URL": "https://staging.example.com" }
  }
}
```

**Run with Matrix Options** lets you pick projects, grep, retries, workers, trace policy, and other flags, then run or save the selection. **Manage Saved Run Presets** can rename, duplicate, replace, or delete presets. File presets require an open test file.

Video overrides are optional. The first video override offers to add a small environment bridge to your Playwright config; the existing video policy remains the fallback. Ordinary runs do not need this bridge.

## Results, artifacts, and coverage

Click the theatre-mask **Playwright Studio** activity-bar icon to open its sidebar. The **Tests** section supports discovery, source navigation, run/debug actions, and refresh. **Results**, **History**, **Components**, and **Annotations** are grouped below it instead of in the file explorer. The sparkle button opens Intelligence.

The Results and History views show captured runs. A trace, screenshot, or video must have been recorded by Playwright before it can be reviewed here. Configure artifact recording in Playwright or select a trace policy in the run options.

**Review and Accept Snapshot Artifacts** opens expected/actual/diff attachments. Accepting a snapshot requires confirmation and changes the expected file in your workspace.

**Import Istanbul/V8 Coverage** loads an existing coverage JSON report into native VS Code coverage. It does not instrument application code. Amber test-recency highlights show tests that have never run through the extension or have not run recently; they are not application code coverage.

## Agent workflows and exports

**Initialize Playwright Test Agents** invokes your installed Playwright CLI. Planner, generator, and healer commands open requests in VS Code Chat using the discovered agent files. They require a compatible Playwright version and a working chat/agent setup.

Markdown, JSON, and JUnit exports work locally. Posting a GitHub summary requires an authenticated `gh` CLI and explicit confirmation. Copying a summary does not post it.

## Troubleshooting

- **No tests found:** run **Run Configuration Health Check**. Check the detected project directory and your Playwright `testDir`/`testMatch`. If several configurations are possible, set `workingDirectory` explicitly.
- **Results missing:** run through the extension and ensure `captureResults` is enabled. A custom wrapper must forward the Playwright arguments and environment. Runs in an unrelated manual terminal do not automatically receive capture settings.
- **HTML report missing:** make sure Playwright produced an HTML report and set `reportPath` if its output directory is custom.
- **Browser executable missing:** run **Install Playwright Browsers** for the project.
- **Environment file unreadable:** select a valid file or clear `envFile`; execution reports this instead of silently using the wrong environment.
- **“Refused to show dialog in tests”:** this is a VS Code test-host restriction. Use a normal VS Code window for interactive work. The history-clear command uses an in-editor confirmation picker and also works in a test host.

[Back to the snippet reference](../README.md#snippets-reference)
