import * as vscode from 'vscode';

export class EnvProfileManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this._onDidChange.event;

  private _active: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this._active = context.workspaceState.get<string>('activeEnvProfile');
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('playwrightSnippets.envProfiles')) {
          this._onDidChange.fire(this._active);
        }
      })
    );
  }

  get activeProfile(): string | undefined {
    return this._active;
  }

  get profileNames(): string[] {
    return Object.keys(this.allProfiles());
  }

  getActiveEnv(): Record<string, string> {
    if (!this._active) return {};
    return this.allProfiles()[this._active] ?? {};
  }

  private allProfiles(): Record<string, Record<string, string>> {
    return vscode.workspace
      .getConfiguration('playwrightSnippets')
      .get<Record<string, Record<string, string>>>('envProfiles', {});
  }

  async switchProfile(): Promise<void> {
    const names = this.profileNames;
    if (names.length === 0) {
      const action = await vscode.window.showInformationMessage(
        'No environment profiles configured. Add them under "playwrightSnippets.envProfiles" in settings.',
        'Open Settings'
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'playwrightSnippets.envProfiles'
        );
      }
      return;
    }

    const items: vscode.QuickPickItem[] = [
      { label: '$(circle-slash) default', description: 'No profile — use base env settings' },
      ...names.map(n => ({
        label: `$(server-environment) ${n}`,
        description: Object.keys(this.allProfiles()[n] ?? {}).join(', '),
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an environment profile',
    });
    if (picked === undefined) return;

    const isDefault = picked.label.startsWith('$(circle-slash)');
    this._active = isDefault ? undefined : picked.label.replace('$(server-environment) ', '');
    await this.context.workspaceState.update('activeEnvProfile', this._active);
    this._onDidChange.fire(this._active);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
