import * as vscode from 'vscode';

// Optional APIs introduced after the minimum supported VS Code version.
export interface BranchCoverage {
  executed: number | boolean;
  location?: vscode.Position | vscode.Range;
  label?: string;
}
export interface FileCoverageDetail {
  executed: number | boolean;
  location: vscode.Position | vscode.Range;
  branches?: BranchCoverage[];
  name?: string;
}
export interface FileCoverage {
  uri: vscode.Uri;
}
export type CompatibleProfile = vscode.TestRunProfile & {
  supportsContinuousRun?: boolean;
  loadDetailedCoverage?: (
    run: vscode.TestRun,
    coverage: FileCoverage,
  ) => Promise<FileCoverageDetail[]>;
};
export const coverageApi = vscode as typeof vscode & {
  BranchCoverage: new (
    executed: number | boolean,
    location?: vscode.Position | vscode.Range,
    label?: string,
  ) => BranchCoverage;
  StatementCoverage: new (
    executed: number | boolean,
    location: vscode.Position | vscode.Range,
    branches?: BranchCoverage[],
  ) => FileCoverageDetail;
  DeclarationCoverage: new (
    name: string,
    executed: number | boolean,
    location: vscode.Position | vscode.Range,
  ) => FileCoverageDetail;
  FileCoverage?: { fromDetails(uri: vscode.Uri, details: FileCoverageDetail[]): FileCoverage };
};

export const hasNativeCoverage =
  Number(vscode.version?.split('.')[1] ?? 0) >= 88 &&
  typeof coverageApi.FileCoverage?.fromDetails === 'function';
