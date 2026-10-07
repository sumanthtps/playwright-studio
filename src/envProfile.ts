import * as vscode from 'vscode';

export class EnvProfileManager implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this._onDidChange.event;

  private readonly activeByFolder: Record<string, string | undefined>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.activeByFolder = context.workspaceState.get<Record<string, string | undefined>>(
      'activeEnvProfiles',
      {}
    );
    const legacy = context.workspaceState.get<string>('activeEnvProfile');
    if (legacy && !this.activeByFolder[this.resourceKey()]) {
      this.activeByFolder[this.resourceKey()] = legacy;
      void context.workspaceState.update('activeEnvProfiles', this.activeByFolder);
      void context.workspaceState.update('activeEnvProfile', undefined);
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('playwrightSnippets.envProfiles')) {
          const key = this.resourceKey();
          const active = this.activeByFolder[key];
          if (active && !this.profileNames.includes(active)) {
            delete this.activeByFolder[key];
            void this.persist();
          }
          this._onDidChange.fire(this.activeProfile);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this._onDidChange.fire(this.activeProfile);
      })
    );
  }

  get activeProfile(): string | undefined {
    return this.activeByFolder[this.resourceKey()];
  }

  get profileNames(): string[] {
    return Object.keys(this.allProfiles());
  }

  getActiveEnv(resource?: vscode.Uri | string): Record<string, string> {
    const active = this.activeByFolder[this.resourceKey(resource)];
    if (!active) return {};
    return this.allProfiles(resource)[active] ?? {};
  }

  private asUri(resource?: vscode.Uri | string): vscode.Uri | undefined {
    if (resource instanceof vscode.Uri) return resource;
    if (typeof resource === 'string' && resource) return vscode.Uri.file(resource);
    return vscode.window.activeTextEditor?.document.uri;
  }

  private resourceKey(resource?: vscode.Uri | string): string {
    const uri = this.asUri(resource);
    return (uri ? vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() : undefined)
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString()
      ?? '__workspace__';
  }

  private allProfiles(resource?: vscode.Uri | string): Record<string, Record<string, string>> {
    return vscode.workspace
      .getConfiguration('playwrightSnippets', this.asUri(resource))
      .get<Record<string, Record<string, string>>>('envProfiles', {});
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update('activeEnvProfiles', this.activeByFolder);
  }

  async switchProfile(resource?: vscode.Uri | string): Promise<void> {
    const profiles = this.allProfiles(resource);
    const names = Object.keys(profiles);
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
        description: Object.keys(profiles[n] ?? {}).join(', '),
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an environment profile',
    });
    if (picked === undefined) return;

    const isDefault = picked.label.startsWith('$(circle-slash)');
    const key = this.resourceKey(resource);
    const active = isDefault ? undefined : picked.label.replace('$(server-environment) ', '');
    if (active) this.activeByFolder[key] = active;
    else delete this.activeByFolder[key];
    await this.persist();
    this._onDidChange.fire(active);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
