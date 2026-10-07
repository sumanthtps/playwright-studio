import * as vscode from 'vscode';

export interface CatalogFeature {
  id: string;
  title: string;
  description: string;
  command?: string;
}

export interface CatalogGroup {
  id: string;
  title: string;
  features: CatalogFeature[];
}

// Shared with the documentation generator; esbuild embeds this small catalog.
export const featureGroups: CatalogGroup[] = require('./featureCatalog.json');
type CatalogNode = CatalogGroup | CatalogFeature;

export class FeaturesViewProvider implements vscode.TreeDataProvider<CatalogNode> {
  getChildren(element?: CatalogNode): CatalogNode[] {
    return !element ? featureGroups : 'features' in element ? element.features : [];
  }

  getTreeItem(element: CatalogNode): vscode.TreeItem {
    const group = 'features' in element;
    const item = new vscode.TreeItem(
      element.title,
      group ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = element.id;
    item.iconPath = new vscode.ThemeIcon(group ? 'list-tree' : 'book');
    if (group) {
      item.description = String(element.features.length);
    } else {
      item.tooltip = `${element.description}\n\nOpen feature details.`;
      item.command = {
        command: 'playwrightSnippets.openFeatureCatalog',
        title: 'Open Feature Details',
        arguments: [element.id],
      };
    }
    return item;
  }

  getParent(element: CatalogNode): CatalogGroup | undefined {
    return featureGroups.find((group) => group.features.includes(element as CatalogFeature));
  }
}

export function openFeatureCatalog(
  context: vscode.ExtensionContext,
  id?: unknown,
): Thenable<unknown> {
  const feature =
    typeof id === 'string'
      ? featureGroups.flatMap((group) => group.features).find((item) => item.id === id)
      : undefined;
  const document = vscode.Uri.joinPath(context.extensionUri, 'docs', 'features.md');
  return vscode.commands.executeCommand(
    'markdown.showPreview',
    feature ? document.with({ fragment: feature.id.toLowerCase() }) : document,
  );
}
