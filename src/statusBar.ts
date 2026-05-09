import * as vscode from 'vscode';
import { ResultStore } from './resultStore';
import { EnvProfileManager } from './envProfile';

export class StatusBarManager implements vscode.Disposable {
  private readonly summaryItem: vscode.StatusBarItem;
  private readonly profileItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(store: ResultStore, profiles: EnvProfileManager) {
    this.summaryItem = vscode.window.createStatusBarItem(
      'playwrightStudio.summary',
      vscode.StatusBarAlignment.Left,
      100
    );
    this.summaryItem.command = 'playwrightSnippets.showReport';
    this.summaryItem.tooltip = 'Playwright last run — click to open HTML report';

    this.profileItem = vscode.window.createStatusBarItem(
      'playwrightStudio.profile',
      vscode.StatusBarAlignment.Left,
      99
    );
    this.profileItem.command = 'playwrightSnippets.switchEnvProfile';
    this.profileItem.tooltip = 'Active Playwright environment profile — click to switch';

    this.disposables.push(
      store.onDidChange(results => {
        const { passed, failed, flaky } = results.summary;
        if (failed > 0) {
          this.summaryItem.text = `$(error) ${passed} passed  ${failed} failed`;
          this.summaryItem.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.errorBackground'
          );
        } else {
          this.summaryItem.text = `$(pass) ${passed} passed`;
          this.summaryItem.backgroundColor = undefined;
        }
        if (flaky > 0) this.summaryItem.text += `  ${flaky} flaky`;
        this.summaryItem.show();
      }),
      profiles.onDidChange(() => this.updateProfileItem(profiles))
    );

    this.updateProfileItem(profiles);
  }

  private updateProfileItem(profiles: EnvProfileManager): void {
    const active = profiles.activeProfile;
    const hasProfiles = profiles.profileNames.length > 0;

    if (!hasProfiles) {
      this.profileItem.hide();
      return;
    }

    this.profileItem.text = active
      ? `$(server-environment) ${active}`
      : '$(server-environment) default';
    this.profileItem.show();
  }

  dispose(): void {
    this.summaryItem.dispose();
    this.profileItem.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
