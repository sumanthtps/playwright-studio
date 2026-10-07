/// <reference lib="dom" />

export interface AnalyticsRun {
  root: string;
  capturedAt: string;
  specs: {
    key: string;
    title: string;
    project: string;
    status: string;
    duration: number;
  }[];
}

/** Runs in the webview. Keep browser behavior separate from extension APIs. */
function analyticsClient(runs: AnalyticsRun[]): void {
  const workspaceFilter = document.getElementById('root') as HTMLSelectElement;
  const projectFilter = document.getElementById('project') as HTMLSelectElement;
  const element = (id: string) => document.getElementById(id)!;
  const isFailure = (spec: AnalyticsRun['specs'][number]) =>
    spec.status === 'failed' || spec.status === 'timedOut';

  function option(value: string, label = value): HTMLOptionElement {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    return item;
  }

  function selectedWorkspaces(): AnalyticsRun[] {
    return runs.filter((run) => !workspaceFilter.value || run.root === workspaceFilter.value);
  }

  function updateProjects(): void {
    const currentProject = projectFilter.value;
    const projects = new Set(
      selectedWorkspaces().flatMap((run) => run.specs.map((spec) => spec.project)),
    );
    projectFilter.replaceChildren(option('', 'All projects'));
    for (const name of [...projects].sort()) projectFilter.append(option(name));
    if (projects.has(currentProject)) projectFilter.value = currentProject;
  }

  function renderCards(selected: AnalyticsRun[]): void {
    const specs = selected.flatMap((run) => run.specs);
    const metrics: [string, number][] = [
      ['Runs', selected.length],
      ['Test executions', specs.length],
      ['Failures', specs.filter(isFailure).length],
      ['Flaky', specs.filter((spec) => spec.status === 'flaky').length],
    ];
    const container = element('cards');
    container.replaceChildren();
    for (const [label, count] of metrics) {
      const card = document.createElement('div');
      card.className = 'card';
      const metric = document.createElement('div');
      metric.className = 'metric';
      metric.textContent = String(count);
      const caption = document.createElement('div');
      caption.className = 'muted';
      caption.textContent = label;
      card.append(metric, caption);
      container.append(card);
    }
  }

  function renderTrend(selected: AnalyticsRun[]): void {
    const failureCounts = selected.map((run) => run.specs.filter(isFailure).length);
    const maximum = failureCounts.reduce((max, count) => Math.max(max, count), 1);
    const trend = element('trend');
    trend.replaceChildren();
    for (let index = selected.length - 1; index >= 0; index--) {
      const failures = failureCounts[index];
      const bar = document.createElement('div');
      bar.tabIndex = 0;
      bar.className = failures ? 'bar fail' : 'bar';
      bar.style.height = `${Math.max(3, (failures / maximum) * 100)}%`;
      bar.title = `${new Date(selected[index].capturedAt).toLocaleString()}: ${failures} failures`;
      bar.setAttribute('aria-label', `${failures} failures`);
      trend.append(bar);
    }
  }

  interface TestMetrics {
    title: string;
    project: string;
    runs: number;
    failed: number;
    flaky: number;
    duration: number;
  }

  function aggregateTests(selected: AnalyticsRun[]): TestMetrics[] {
    const metrics = new Map<string, TestMetrics>();
    for (const run of selected) {
      for (const spec of run.specs) {
        const total = metrics.get(spec.key) ?? {
          title: spec.title,
          project: spec.project,
          runs: 0,
          failed: 0,
          flaky: 0,
          duration: 0,
        };
        total.runs++;
        if (isFailure(spec)) total.failed++;
        if (spec.status === 'flaky') total.flaky++;
        total.duration += spec.duration;
        metrics.set(spec.key, total);
      }
    }
    return [...metrics.values()];
  }

  function appendRow(table: HTMLElement, values: (string | number)[]): void {
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    table.append(row);
  }

  function renderTables(selected: AnalyticsRun[]): void {
    const metrics = aggregateTests(selected);
    const failureRate = (test: TestMetrics) => (test.failed + test.flaky) / test.runs;
    const averageDuration = (test: TestMetrics) => test.duration / test.runs;
    const unstable = element('unstable');
    unstable.replaceChildren();
    for (const test of metrics.sort((a, b) => failureRate(b) - failureRate(a)).slice(0, 50)) {
      appendRow(unstable, [
        test.title,
        test.project,
        test.runs,
        test.failed,
        test.flaky,
        `${Math.round(failureRate(test) * 100)}%`,
      ]);
    }
    const slow = element('slow');
    slow.replaceChildren();
    for (const test of metrics
      .sort((a, b) => averageDuration(b) - averageDuration(a))
      .slice(0, 50)) {
      appendRow(slow, [
        test.title,
        test.project,
        test.runs,
        `${Math.round(averageDuration(test))}ms`,
      ]);
    }
  }

  function render(): void {
    const selected = selectedWorkspaces().map((run) => ({
      ...run,
      specs: run.specs.filter(
        (spec) => !projectFilter.value || spec.project === projectFilter.value,
      ),
    }));
    renderCards(selected);
    renderTrend(selected);
    renderTables(selected);
  }

  workspaceFilter.append(option('', 'All workspaces'));
  for (const root of [...new Set(runs.map((run) => run.root))].sort())
    workspaceFilter.append(option(root));
  workspaceFilter.addEventListener('change', () => {
    updateProjects();
    render();
  });
  projectFilter.addEventListener('change', render);
  updateProjects();
  render();
}

export function analyticsScript(runs: AnalyticsRun[]): string {
  // A title containing </script> must remain data inside the script element.
  const data = JSON.stringify(runs).replace(/</g, '\\u003c');
  return `(${analyticsClient.toString()})(${data});`;
}
