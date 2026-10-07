# Playwright Studio v2 feature tour

[Back to README](../README.md) · [Watch the GIF](../images/preview-v2.gif) · [All features](features.md)

The new tour contains **10 captioned scenes in 48 seconds**, covering everyday testing and the v2 selector and investigation workflows.

The editor, presets, results, analytics and snippet scenes are retained VS Code captures with deterministic sample data. The selector, DevTools, Intelligence and Scenario Lab scenes are fresh captures of the current extension's real interfaces from the browser validation suites. The selector demo uses a local sample storefront. These are feature demonstrations; the animation does not claim that every workflow or an external agent was executed.

## Scene index

| Start | Scene | What is shown |
| --- | --- | --- |
| 0:00 | [Run, debug, inspect](../images/demo/01-editor.jpg) | Start from your test source with inline actions and the Studio sidebar. |
| 0:04 | [Keep the run setup](../images/demo/03-presets.jpg) | Reuse projects, tags, retries and environment settings with saved presets. |
| 0:08 | [Review every outcome](../images/demo/02-results.jpg) | Jump from passed, failed and flaky results back to the test source. |
| 0:12 | [Find a reliable locator](../images/demo/20-selector-intelligence.png) | Inspect the live page, compare match counts and copy a Playwright locator. |
| 0:18 | [Open full Chrome DevTools](../images/demo/21-chrome-devtools.png) | Inspect the same browser page without replacing its state. |
| 0:22 | [Investigate with evidence](../images/demo/22-intelligence-dashboard.png) | Choose Failure Detective, Scenario Lab, Verified Repair or Test the Tests. |
| 0:28 | [Reproduce difficult conditions](../images/demo/23-scenario-lab.png) | Save latency, HTTP errors, offline mode and browser-clock scenarios. |
| 0:34 | [Go deeper when needed](../images/demo/24-advanced-workflows.png) | Explore Bug Capsules, Product Laws, Repair Challenges and other experiments. |
| 0:40 | [Spot unstable and slow tests](../images/demo/05-analytics.jpg) | Review failure trends, flaky outcomes and duration changes from local history. |
| 0:44 | [Write the next test faster](../images/demo/13-snippets.jpg) | Browse 338 JavaScript and TypeScript snippets with the p- prefix. |

## Rebuild the tour

On macOS, install the project dependencies, Playwright Chromium, FFmpeg and the Swift command-line tools. Generate fresh panel captures, then assemble the GIF:

```sh
npm ci
npx playwright install chromium
npm run demo:captures
npm run demo:gif
```

`demo:captures` runs the browser, selector and DevTools suites against local fixtures and copies their screenshots into `images/demo`. The captured panels use a mock VS Code message bridge; the selector and DevTools tests communicate with a real local Chromium page. The original VS Code scenes remain available in the same directory.

Edit `scripts/demo-scenes.json` to change captions, order or duration. The renderer fits each source image onto a consistent 1280 × 900 canvas, adds a caption below the interface, and writes `images/preview-v2.gif`. It preserves the original screenshots. Demo media is excluded from the packaged extension.

See [validation coverage and limits](../test/README.md) for what the automated checks establish.
