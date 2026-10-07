import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { workflowGroups, prerequisites } from './dashboard';
import { intelligenceClient } from './client';
export interface ReportSection {
  title: string;
  text?: string;
  columns?: string[];
  rows?: (string | number)[][];
  details?: unknown;
}
export interface IntelligenceReport {
  title: string;
  introduction: string;
  sections: ReportSection[];
  evidenceFile?: string;
  actions?: { id: string; title: string }[];
}
export const features = [
  [
    'investigateFailures',
    'Failure Detective',
    'Compare failures, passing runs, and trace evidence.',
  ],
  ['testTheTests', 'Test the Tests', 'Run controlled code mutations in an isolated copy.'],
  [
    'openScenarioLab',
    'Scenario Lab',
    'Combine latency, HTTP errors, offline mode, and browser time.',
  ],
  [
    'showBehaviorMap',
    'Living Behavior Map',
    'Explore routes, semantic roles, assertions, and uncovered promises.',
  ],
  [
    'showChangeRadar',
    'Change Radar',
    'Choose checks for a time budget and inspect what remains unverified.',
  ],
  [
    'verifyRepair',
    'Verified Repair',
    'Compare an existing test with a candidate repair and rerun both.',
  ],
  [
    'benchmarkJourneys',
    'Human & Agent Journeys',
    'Benchmark your scripted and agent test adapters against shared criteria.',
  ],
  [
    'managePromises',
    'Product Promises',
    'Track the current evidence for your product’s behavioral requirements.',
  ],
  [
    'openBugCapsules',
    'Bug Capsules',
    'Package a reproduced failure and replay its reviewed sources and recipe.',
  ],
  [
    'branchFailure',
    'Branch the Failure',
    'Replay a journey with controlled response ordering and action checkpoints.',
  ],
  [
    'checkProductLaws',
    'Product Laws',
    'Explore seeded action sequences and reduce a failing law to a regression.',
  ],
  [
    'openAgentWindTunnel',
    'Agent Wind Tunnel',
    'Compare agent models under interruptions and adversarial conditions.',
  ],
  [
    'challengeRepair',
    'Repair Challenges',
    'Require repaired tests to detect deliberately broken application behavior.',
  ],
  [
    'showBehaviorDiff',
    'Behavior Diff',
    'Compare runtime observations and outcomes across two source revisions.',
  ],
  [
    'openIncidentMemory',
    'Incident Memory',
    'Preserve incidents, regression checks, and the defects they must detect.',
  ],
] as const;
const escape = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export class IntelligencePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private report?: IntelligenceReport;
  private root = '';
  private actionInFlight = false;
  private readonly allowedActions = new Set<string>();
  constructor(private readonly action: (id: string, value?: unknown) => Promise<void>) {}
  show(root: string, report?: IntelligenceReport): void {
    this.root = root;
    this.report = report;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'playwrightStudio.intelligence',
        'Playwright Intelligence',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (
          !message ||
          typeof message.action !== 'string' ||
          !this.allowedActions.has(message.action)
        )
          return;
        if (this.actionInFlight && message.action !== 'cancelWorkflow') return;
        const cancelling = message.action === 'cancelWorkflow';
        if (!cancelling) this.actionInFlight = true;
        try {
          await this.action(message.action, message.value);
          if (!cancelling)
            await this.panel?.webview.postMessage({
              type: 'actionState',
              busy: false,
              message: 'Ready. If you dismissed a picker, choose the action again to continue.',
            });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          await this.panel?.webview.postMessage({
            type: 'actionState',
            busy: false,
            error: true,
            message: text,
          });
          await vscode.window.showErrorMessage(`Playwright Studio: ${text}`);
        } finally {
          if (!cancelling) this.actionInFlight = false;
        }
      });
    }
    this.panel.webview.html = this.html();
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }
  private html(): string {
    const token = randomBytes(18).toString('hex');
    const report = this.report;
    this.allowedActions.clear();
    this.allowedActions.add('cancelWorkflow');
    if (!report) for (const [id] of features) this.allowedActions.add(id);
    if (report?.title === 'Scenario Lab') this.allowedActions.add('saveScenario');
    const button = (id: string, title: string) => {
      this.allowedActions.add(id);
      return `<button data-action="${escape(id)}">${escape(title)}</button>`;
    };
    const cell = (value: unknown): string => {
      const match = /^(?![\\/]|https?:)(.*\.[cm]?[jt]sx?)(?::(\d+))?$/.exec(String(value));
      if (match) this.allowedActions.add('openSource');
      return match
        ? `<button data-action="openSource" data-file="${escape(match[1])}" data-line="${match[2] ?? 1}">${escape(value)}</button>`
        : escape(value);
    };
    const dashboard = () => {
      const cards = (ids: string[]) =>
        ids
          .map((id) => {
            const feature = features.find((item) => item[0] === id)!;
            return `<button class="workflow-card card" data-action="${escape(id)}"><strong>${escape(feature[1])}</strong><span>${escape(feature[2])}</span><small class="requirement">${escape(prerequisites[id])}</small><span class="open-label">Open workflow →</span></button>`;
          })
          .join('');
      return `<div class="quickstart"><div><strong>New here? Start with a project check.</strong><p>Most workflows need local tests, captured results, or an adapter. Each option lists what it needs.</p></div><div class="actions">${button('checkWorkspace', 'Check setup')}${button('openIntelligenceHelp', 'Read workflow guide')}${button('openSelectorIntelligence', 'Inspect website selectors')}</div></div>
        <label class="search-label" for="search">Find a workflow<input id="search" type="search" placeholder="Search failures, scenarios, coverage…"></label>
        ${workflowGroups
          .map((group) =>
            group.advanced
              ? `<details class="workflow-group"><summary><strong>${escape(group.title)}</strong><span>${escape(group.description)}</span></summary><div class="cards">${cards(group.ids)}</div></details>`
              : `<div class="workflow-group"><div class="group-heading"><h2>${escape(group.title)}</h2><p>${escape(group.description)}</p></div><div class="cards">${cards(group.ids)}</div></div>`,
          )
          .join('')}
        <p id="noMatches" hidden>No matching workflow. Try another search.</p><div class="actions">${button('editIntelligenceConfig', 'Edit shared configuration')}</div>`;
    };
    const controls =
      report?.title === 'Scenario Lab'
        ? `<section><h2>Create a scenario</h2><form id="scenario"><label>Name<input name="name" required maxlength="100" placeholder="Expired checkout"></label><label>Request URL glob<input name="urlPattern" value="**/api/**" required></label><div class="formrow"><label>Latency (ms)<input name="latencyMs" type="number" min="0" max="30000" value="0" required></label><label>HTTP error<select name="status"><option value="">Unchanged</option><option>401</option><option>403</option><option>429</option><option>500</option><option>503</option></select></label></div><label>Browser time (ISO with timezone)<input name="clock" placeholder="2030-01-01T00:00:00Z"></label><label class="check"><input type="checkbox" name="offline"> Offline</label><button type="submit">Save scenario</button></form><div class="actions">${button('runScenario', 'Run saved scenario')}${button('exportScenario', 'Export reusable fixture')}</div></section>`
        : '';
    const contextual =
      report?.title === 'Product Promises'
        ? button('createPromise', 'Add promise') + button('runProductPromises', 'Run linked tests')
        : report?.title === 'Human & Agent Journeys'
          ? button('createJourney', 'Add journey') + button('runJourney', 'Run benchmark')
          : report?.title === 'Change Radar'
            ? button('runImpactPlan', 'Run selected checks') +
              button('runFullSuite', 'Validate with full suite') +
              button('importTestCoverage', 'Import per-test coverage')
            : report?.title === 'Failure Detective'
              ? button('runFailureExperiment', 'Repeat failures with tracing')
              : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${token}'; script-src 'nonce-${token}';"><style nonce="${token}">
:root{color-scheme:light dark}*{box-sizing:border-box}body{max-width:1200px;margin:0 auto;padding:28px;font:13px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}header{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:22px;margin-bottom:22px}.eyebrow{font-size:11px;letter-spacing:.12em;color:var(--vscode-descriptionForeground)}h1{font-size:28px;font-weight:600;margin:10px 0}h2{font-size:17px;margin-top:0}p{line-height:1.6;max-width:90ch}.muted,small{color:var(--vscode-descriptionForeground)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:12px}.card,section{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:18px;background:var(--vscode-sideBar-background)}.card{text-align:left;display:block;color:inherit}.card strong{display:block;font-size:15px;margin-bottom:8px}.card span{display:block;font-size:12px;line-height:1.5;color:var(--vscode-descriptionForeground)}.card:hover{border-color:var(--vscode-focusBorder)}section{margin:16px 0;overflow:auto}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}button{font:inherit;cursor:pointer;padding:8px 12px;border:1px solid transparent;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}button:disabled{opacity:.5;cursor:wait}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;overflow-wrap:anywhere}th{color:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px var(--vscode-editor-font-family);line-height:1.5}label{display:block;margin:10px 0}input,select{display:block;width:100%;padding:8px;margin-top:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}.formrow{display:flex;gap:16px}.formrow label{flex:1}.check input{width:auto;display:inline}summary{cursor:pointer;padding:8px 0}#status{min-height:20px}

.quickstart{padding:20px 22px;border:1px solid var(--vscode-focusBorder);border-radius:10px;background:var(--vscode-sideBar-background);margin-bottom:24px}.quickstart strong{font-size:16px}.quickstart p{margin-bottom:0}.search-label{max-width:600px;color:var(--vscode-descriptionForeground)}.workspace{display:inline-block;border:1px solid var(--vscode-panel-border);padding:5px 10px;border-radius:20px}.group-heading{margin-top:30px}.group-heading h2{margin-bottom:4px}.group-heading p{margin-top:0;color:var(--vscode-descriptionForeground)}.workflow-group{margin:24px 0}.workflow-group>summary{padding:16px 0}.workflow-group>summary strong{font-size:17px}.workflow-group>summary span{display:block;margin:6px 0;color:var(--vscode-descriptionForeground)}.workflow-card{min-height:180px;display:flex;flex-direction:column;gap:8px;padding:20px;border-radius:10px}.workflow-card strong{margin:0;font-size:16px}.workflow-card .requirement{border-top:1px solid var(--vscode-panel-border);padding-top:10px;margin-top:auto;font-size:11px}.workflow-card .open-label{color:var(--vscode-textLink-foreground);font-size:12px;margin-top:6px}.cards{grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.statusbar{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:10px 0;background:var(--vscode-editor-background);border-top:1px solid var(--vscode-panel-border)}#status{margin:0;flex:1}.error{color:var(--vscode-errorForeground)}[hidden]{display:none!important}@media(max-width:600px){body{padding:16px}.cards{grid-template-columns:1fr}h1{font-size:24px}}
</style></head><body><header><div class="eyebrow">PLAYWRIGHT STUDIO / INTELLIGENCE</div><h1>${escape(report?.title ?? 'Your test investigation workspace')}</h1><p>${escape(report?.introduction ?? 'Choose a focused workflow. See what it needs, run it, and review the evidence.')}</p><small class="workspace" title="${escape(this.root)}">Project · ${escape(path.basename(this.root))}</small></header>
${report ? `<div class="actions">${button('openIntelligence', 'All workflows')}${contextual}${report.actions?.map((a) => button(a.id, a.title)).join('') ?? ''}${button('editIntelligenceConfig', 'Edit configuration')}${report.evidenceFile ? button('openEvidence', 'Open saved evidence') + button('openRunArtifact', 'Open artifact') : ''}</div>` : dashboard()}
${controls}${report?.sections.map((section) => `<section><h2>${escape(section.title)}</h2>${section.text ? `<p>${escape(section.text)}</p>` : ''}${section.columns ? `<table><thead><tr>${section.columns.map((c) => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${section.rows?.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${section.columns.length}">No evidence yet.</td></tr>`}</tbody></table>` : ''}${section.details !== undefined ? `<details><summary>Inspect evidence</summary><pre>${escape(JSON.stringify(section.details, null, 2))}</pre></details>` : ''}</section>`).join('') ?? ''}<div class="statusbar"><p id="status" role="status" aria-live="polite">Ready.</p><button id="cancel" data-action="cancelWorkflow" hidden>Cancel run</button></div>
<script nonce="${token}">(${intelligenceClient.toString()})();</script></body></html>`;
  }
  dispose(): void {
    this.panel?.dispose();
  }
}
