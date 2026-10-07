# Playwright Intelligence

Open **Playwright Studio: Open Intelligence Dashboard** from the Command Palette. The dashboard contains the eight original workflows below plus seven [advanced workflows](lab.md): Bug Capsules, Branch the Failure, Product Laws, Agent Wind Tunnel, Repair Challenges, Behavior Diff, and Incident Memory. All analysis and reports stay local. Existing Playwright planner/generator/healer commands remain available independently.

## Workflow guide

| Workflow | How to use it | What the result establishes |
| --- | --- | --- |
| Failure Detective | Capture a test run, open Investigate Failures, then inspect grouped symptoms, prior passing runs, trace events, and suggested experiments. Use **Repeat failures with tracing** to rerun selected failures three times with one worker. | Observed similarities and reproduction evidence. Explanations are hypotheses, not proven root causes. |
| Test the Tests | Open or modify an application source file. Choose up to ten mutations and the tests to challenge. | A passing baseline followed by a failing selected test detects a mutation. A survivor requires checking that the mutated source actually ran. |
| Scenario Lab | Use the form to save latency, HTTP error, offline, and browser-clock conditions; run a saved scenario against selected tests. | A baseline/scenario comparison, interception counts, and bounded attempts to remove unnecessary conditions while preserving the failure signature. Reduced recipes are saved automatically. |
| Living Behavior Map | Open the map to index literal routes, semantic UI roles, test steps, assertions, dependencies, and promise links. | Static declarations and review candidates. Helper assertions, dynamic titles/routes, and authorization roles cannot be inferred reliably. |
| Change Radar | Enter a time budget. Review changed files, selected tests, reasons, and unverified tests; then run the selection. | An explainable selection based on imports, optional per-test coverage, history, and business priority. **Validate with full suite** checks for failures outside that selection. |
| Verified Repair | Open the original failing test, select a separate candidate repair file, and choose the failing tests. | Original-failure reproduction, a conservative assertion/control-flow audit, and three candidate repetitions. Candidates are never applied to your workspace automatically. |
| Human & Agent Journeys | Add a journey linking a scripted interaction test and an agent adapter test to shared success criteria. Run the benchmark. | Repeated observed outcomes, durations, model/version labels, and artifacts. Each adapter must assert the criteria; Studio does not supply or invoke an agent provider itself. |
| Product Promises | Add an observable promise, owner, priority, and linked tests. Run the linked tests and inspect freshness. | Whether the latest observed checks support the promise on the current source fingerprint. A passing test does not establish exhaustive behavioral coverage. |

Every analysis report can be reopened as JSON with **Open saved evidence**. **Open artifact** opens retained source files, JSON reports, screenshots, and other attachments; ZIP traces open in Playwright Trace Viewer.

## Shared configuration

Configuration lives in `studio.json` inside VS Code’s private workspace storage, outside your repository. Studio does not edit `.gitignore` or other ignore files. Existing `.playwright-studio` files are migrated after verifying their copies; conflicting copies are preserved for you to resolve. The extension provides JSON validation and completions. The dashboard can add scenarios, promises, and journeys; **Edit configuration** supports changing or removing entries.

```json
{
  "version": 1,
  "promises": [
    {
      "id": "billing-viewer",
      "statement": "A viewer cannot edit billing",
      "owner": "billing-team",
      "priority": "critical",
      "maxAgeDays": 7,
      "tests": [
        {
          "file": "tests/billing.spec.ts",
          "title": "viewer cannot edit billing",
          "project": "chromium"
        }
      ]
    }
  ],
  "scenarios": [
    {
      "id": "shipping-unavailable",
      "name": "Shipping service unavailable",
      "urlPattern": "**/api/shipping/**",
      "latencyMs": 500,
      "status": 503,
      "offline": false,
      "clock": "2030-01-01T00:00:00Z"
    }
  ],
  "journeys": [],
  "coverage": []
}
```

Test references use workspace-relative paths and literal test titles. An optional `titlePath`, such as `["checkout", "guest purchase"]`, disambiguates suites with duplicate leaf titles. An optional `project` narrows the reference to one browser project; without it, evidence describes the projects observed in the matching run. Static discovery cannot enumerate dynamically generated test titles: explicitly configured references can target those runtime titles.

## Per-test coverage input

Change Radar accepts a JSON file with `version: 1` and `coverage` entries:

```json
{
  "version": 1,
  "coverage": [
    {
      "test": { "file": "tests/checkout.spec.ts", "title": "guest purchase" },
      "files": ["src/checkout.ts", "src/shipping.ts"],
      "revision": "full-git-commit-sha"
    }
  ]
}
```

Produce these links from your per-test instrumentation. Aggregate Istanbul/V8 reports do not identify which test exercised a file; the existing aggregate coverage importer is separate. Coverage from another revision is labeled historical and used only as a selection hint. Import relationships are also hints: unresolved path aliases and browser-to-server dependencies are listed as limitations. The time budget excludes startup/setup and is an estimate, not a runtime guarantee.

## Scenario fixtures

The isolated runner redirects actual `@playwright/test` imports to a generated fixture, including custom fixtures that extend that test base. It configures context routing/offline state and the page clock before test execution. Each result gets a `studio-scenario` attachment with the applied recipe and intercepted request count.

A custom fixture or service worker can override/bypass routing. Check interception counts before interpreting an HTTP scenario. Browser clock control does not change server time. The reducer tries removing each active condition once and retains only failures with the same normalized signature; it does not prove global minimality or causation.

**Export reusable fixture** opens a uniquely named local `scenario-*.ts` module with a selected recipe embedded. It stays outside the repository. To share it with a test suite, explicitly save a copy in your chosen fixtures directory and import its `test` and `expect`. Existing test bodies remain normal Playwright code.

## Journey adapters

Each adapter receives `PLAYWRIGHT_STUDIO_JOURNEY` with `objective`, `successCriteria`, `model`, and `mode` (`human` or `agent`). The human adapter is a scripted user interaction, not a real human study. The agent adapter calls your chosen provider using your existing test fixtures. Both must assert success conditions and any forbidden actions, and may attach additional evidence using `testInfo.attach()`.

Configure a journey through the panel, then adjust repetitions (1–20) in the shared configuration. Reports show passes, failures, skipped/other outcomes, and total duration for each adapter and retain model/version context. Studio does not invent success criteria measurements or infer accessibility compliance from a pass.

## Evidence and isolation

- Normal captured runs now retain individual attempts, step summaries, attachments, stdout/stderr, Git revision/dirty fingerprint, and Node/platform metadata. Reporter capture preserves configured reporters. Historical reports without these fields continue to load, but cannot establish current-revision evidence.
- Experiments run saved application files in a temporary copy. They reuse installed `node_modules` through links, preserve project fixtures, disable retries and snapshot updates, use one worker, retain traces, and write separate result/artifact directories. This isolates edits; it is not a security sandbox for application/test code or external services.
- The runner uses the application’s installed Playwright and configured tool command. It requires an application-level `playwright.config.*`. Start from the application folder in a monorepo. Source symlinks and web-server working directories outside the copied application are rejected.
- Configured web servers start in the copy with `reuseExistingServer: false`. An occupied port produces an inconclusive execution. Remote URLs and prebuilt assets are not rebuilt automatically: mutations only test the source actually loaded by the application.
- Save open edits before execution. Each process has a configurable deadline, `playwrightSnippets.intelligenceRunTimeoutMs` (default 180,000 ms), and VS Code cancellation. Missing tests, global errors, skipped/flaky/interrupted attempts, expected failures, and inconsistent exit codes are inconclusive.
- Source snapshots are removed after experiments. The latest 20 experiment directories and 100 analysis records are retained in VS Code extension storage; older artifact links may expire. The latest 100 experiment run records supply local promise/history evidence.
- Scans are bounded to 20,000 entries; source analysis is capped at 32 MB and ignores files larger than 1 MB and common dependency/output directories. Snapshot copies are bounded to 256 MB and 20,000 entries. Trace analysis reads at most a 64 MB archive and 16 MB of event data without extracting archive paths.

## Validation

```sh
npm run typecheck
npm test
npm run test:experiments
npm run test:integration
# Requires a Playwright browser installation, or select an installed Chrome:
STUDIO_BROWSER_CHANNEL=chrome npm run test:browser
```

The portable tests cover parsing, selection, stale evidence, path boundaries, configuration validation, repair audits, and command/UI contracts. Real Playwright tests exercise mutation detection/survival, repeated repairs, fixture composition, reporter compatibility, and journey inputs. Browser tests exercise actual routing, time, offline state, and trace extraction against a temporary local server. Agent-provider behavior remains the responsibility of the configured executable adapter.
