# Advanced testing workflows

Open **Playwright Studio: Open Intelligence Dashboard**. The seven additional workflows use the existing isolated Playwright runner and save their execution evidence alongside the original intelligence reports. Configuration lives in local `lab.json` alongside `studio.json` in VS Code’s workspace storage, outside the repository. Use **Edit lab configuration** to open it; the bundled JSON schema still provides validation. Existing `.playwright-studio` files are moved with their contents preserved, without changing ignore files. Generated adapters and fixtures also stay local.

## Bug Capsules

Choose **Bug Capsules → Capture failure**, select failing tests, review the source files to include, and optionally choose a branch recipe. Include the Playwright config, package manifest and lockfile, server sources, test fixtures, static assets, and any sanitized HAR files your tests load. The extension first executes this reviewed bundle. It exports a `.capsule.json` only when the bundle reproduces a failure and any configured branch was observed.

The capsule contains checksummed file contents, test references, source evidence, Node/OS/architecture/Playwright versions, dependency lock fingerprint, synthetic seed, recipe, prerequisite notes, and the observed failure signature. Known environment/credential files, private keys, dependencies and generated outputs are excluded. Review still matters: file-name exclusions cannot recognize secrets embedded in ordinary source or HAR files.

**Open capsule** validates its checksums and paths and opens the manifest for inspection. **Reproduce imported sources** executes the imported application in a disposable copy using the current workspace's installed dependencies. The original workspace remains unchanged. Missing/different runtime information is shown explicitly even if the failure signature matches. The application can read `PLAYWRIGHT_STUDIO_SEED` to implement reproducible synthetic data setup.

A capsule does not capture a database, external service, running server process, or every source of nondeterminism. Implement backend reset and network replay in your fixtures. HAR files are ordinary reviewed inputs; capsule capture does not automatically record live traffic. Imported tests and configured server commands are executable application code; an isolated copy is not an operating-system security sandbox. Each file is limited to 4 MB and the decoded bundle to 32 MB.

## Branch the Failure

Add a branch with a request glob and one or more conditions (use **Edit lab configuration** to combine them):

- Response latency or HTTP status.
- Hold matching requests until a response URL contains `releaseAfter`.
- Offline mode or cookie removal.
- Browser clock changes.
- Synthetic misleading page text for agent evaluation. Text is inserted as text content, not executable HTML.

Leave the checkpoint empty to apply conditions before the journey. For precise activation, export the checkpoint fixture, explicitly save a copy in your test suite’s fixtures directory, and import its `test`/`expect` into your test base:

```ts
import { test, expect } from './fixtures/lab-fixture-<id>';

test('checkout', async ({ page, studio }) => {
  await page.goto('/checkout');
  await studio.checkpoint('before payment');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByText('Order confirmed')).toBeVisible();
});
```

Set `checkpoint` to `before payment`. The comparison reruns setup from the beginning; it does not resume a live process from a trace. A response-ordering gate waits up to five seconds. Missing checkpoints/interceptions, a gate timeout, or unobserved injected text make the condition inconclusive. Cookie removal does not revoke a server-side session, and browser clock control does not change server time. Your adapters can coordinate multiple tabs or users using normal Playwright contexts.

## Product Laws

**Add law and adapter** creates a versioned law and an adapter scaffold that intentionally fails until its business logic is implemented. Export:

```ts
import { expect } from '@playwright/test';

export async function setup({ request }, seed: number) {
  // Implement an idempotent reset of a test-only backend here.
  const response = await request.post('/test/reset', { data: { seed } });
  expect(response.ok()).toBeTruthy();
  return { request, seed };
}

export const actions = {
  retry: async ({ request, seed }) => {
    await request.post('/orders', { data: { idempotencyKey: String(seed) } });
  },
  refresh: async ({ request }) => { await request.get('/orders'); },
};

export async function check({ request, seed }) {
  const response = await request.get(`/orders?key=${seed}`);
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).length).toBeLessThanOrEqual(1);
}

export async function cleanup(state) {
  // Release resources created by setup, when needed.
}
```

This example assumes test-only reset/query endpoints supplied by your application. Check the invariant independently of action implementation. Configure `trials` (1–1000), `maxSteps` (1–100), and a 32-bit `seed` in `lab.json`. Choose an existing test directory for the generated `.spec.ts` runner.

The runner calls setup for each seeded sequence, checks the initial state, and checks after each action. On failure it records the sequence, reproduces it, and tries up to 30 removal experiments while retaining the same failure signature. **Export regression** writes a normal Playwright test with the reduced case and your adapter import. No LLM provider is required. Replay depends on your adapter resetting its state; a passing set of trials does not prove the law for every input.

## Agent Wind Tunnel

First configure an agent journey under **Human & Agent Journeys**. Add a wind-tunnel benchmark selecting that journey, model/version labels, branch conditions, and forbidden actions. Baseline conditions always run, followed by selected branches. Limits are five models, five branches, 20 repetitions per combination, and 200 total attempts.

Your existing journey adapter invokes the actual provider. Studio supplies `PLAYWRIGHT_STUDIO_JOURNEY` with the objective, criteria, requested model, mode and forbidden actions. Attach exactly one measurement per attempt:

```ts
await testInfo.attach('studio-agent-metrics', {
  contentType: 'application/json',
  body: Buffer.from(JSON.stringify({
    model: journey.model,           // actual provider/model used
    completed: evaluation.completed,
    forbiddenActions: evaluation.forbiddenActions,
    recovered: evaluation.recovered, // true, false, or null if not evaluated
    costUsd: measuredCost,          // optional; unknown stays unknown
  })),
});
expect(evaluation.forbiddenActions).toEqual([]);
expect(evaluation.completed).toBe(true);
```

The report shows execution outcomes, measured attempts, completion, forbidden-action occurrences, recovery, and known costs. Invalid or absent metrics do not count as measurements. Model labels alone do not switch providers: the adapter must use the requested model. The automated repository tests use deterministic simulated adapters and do not call paid providers.

## Repair Challenges

Open the original failing test and choose **Challenge a Candidate Repair**. Select a separate candidate file, the affected tests, and up to ten application mutations. Studio reproduces the original failure, runs the candidate three times on the original application, and challenges it with each mutation in turn.

A passing control is a surviving defect and rejects the challenge. Missing, skipped, interrupted or inconsistent executions remain inconclusive. Assertion/control-flow changes are flagged for review even when all controls are detected. Source hashes reject stale controls. The extension does not apply the candidate automatically. A detected control establishes a failing check for that selected defect, not general correctness or causal attribution for arbitrary failures.

## Behavior Diff

Choose a baseline Git revision and the journeys to execute. Studio reads baseline blobs without checking out your repository and runs both the baseline and saved workspace in disposable copies. Both runs reuse current installed dependencies; lock differences are reported.

The report compares test outcomes, final ARIA snapshots, focus information, URL paths and response statuses. It retains screenshots and traces. Exported checkpoint fixtures can add explicit observations with `await studio.observe('cart after retry', value)`. Query strings are omitted from automatic URL observations; ARIA content and custom observations may still contain application data.

Missing tests or captures are labeled incomplete. Changed observations require review; Studio does not infer whether a changed label is an intended redesign or a regression. Dynamic content can produce differences. Source bundles omit known credentials and generated artifacts, so applications that depend on them must supply test fixtures and configuration explicitly. Current dependency versions may be unsuitable for an older revision.

## Incident Memory

Record a sanitized reproduction summary, owner, affected files, regression tests, optional product law and optional negative control. Import/export individual incident JSON records to preserve this knowledge with the repository. A workspace-relative `capsule` field can link a separately reviewed reproduction package.

**Validate regression** runs the current checks, then the recorded application defect. It distinguishes a detected defect, a survivor, missing negative controls and inconclusive runs. It never modifies the application's working files.

Change Radar surfaces incidents when recorded affected files change and gives their linked regression tests critical business priority in its budgeted selection. These direct file links are reviewed history, not exhaustive dependency inference.

## Execution and retention

All new execution commands use the existing workspace trust check, saved-file requirement, temporary source copies, process deadlines, cancellation, zero retries and disabled snapshot updates. Saved reports include raw evidence and links to retained artifacts. Experiment source copies are deleted afterward; the existing 20-experiment and 100-report retention limits apply. Exported capsules and regressions persist until you remove them.

Commands that ask for a file, test, model label or business rule are collecting workflow inputs. The extension does not silently invent missing application adapters or convert absent evidence into passing results.

Local Product Law adapters retain their workspace-relative import paths when Studio copies them into an isolated experiment. Exported law regressions open in a local project copy with their adapters and dependencies, preserving runnable imports without writing generated tests into your repository.
