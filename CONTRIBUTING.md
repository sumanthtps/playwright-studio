# Contributing

Use Node.js 22 and `npm ci`. The extension uses the workspace's installed Playwright; development tests use the pinned lockfile dependencies.

## Find the right code

| Area | Files |
| --- | --- |
| Activation and disposal | `src/extension.ts` |
| Commands and run configuration | `src/commands/`, `src/featureCommands.ts`, `src/config.ts` |
| VS Code tasks and CLI probes | `src/terminal.ts`, `src/processCapture.ts` |
| Discovery, results and persistence | `src/testExplorer.ts`, `src/resultParser.ts`, `src/resultStore.ts`, `src/runHistory.ts` |
| Browser-side analytics | `src/webviews/analytics.ts` |
| Filesystem boundaries | `src/fileSecurity.ts`, `src/security.ts` |
| Optional experiment workflows | `src/intelligence/` |
| Snippets | `snippets/playwright.json` |
| Feature descriptions | `src/featureCatalog.json` |

## Make a change

Keep functions focused on one action. Name variables after their role, extract repeated logic, and prefer early returns over nested conditions. Keep user messages about the user's task. Browser-side code must not depend on VS Code or Node APIs; the analytics client is serialized into its webview and must remain self-contained.

Edit snippets directly; the previous one-time migration script has been removed. After changing feature descriptions, run `npm run docs:features` to regenerate the catalog. Tour assets are used by the README; `node scripts/build-demo-gif.js` rebuilds them on macOS with Swift and FFmpeg.

Run:

```sh
npm run format
npm run typecheck
npm test
```

TypeScript rejects unused locals and parameters. CI also checks formatting. Add a regression test for behavioral fixes, especially execution, cancellation, report parsing, and file boundaries. Follow [the test guide](test/README.md) for real Playwright, browser, and VS Code checks.

## Build a reviewable release

```sh
npm run package -- --out playwright-studio.vsix
node scripts/verify-vsix.js playwright-studio.vsix
```

Update the changelog and version before publishing. The release workflow validates the package before publication. Do not commit generated bundles, VSIX files, test output, dependencies, tokens, or local environment files.
