import * as vscode from 'vscode';

export interface TestItem {
  name: string;
  line: number;
  kind: 'test' | 'describe';
  tags: string[];
}

export function extractTags(testName: string): string[] {
  return testName.match(/@[\w-]+/g) ?? [];
}

// Matches: test('name', ...) | test.only('name', ...) | test.skip('name', ...)
// Also matches: it('name', ...) variants
const TEST_RE =
  /^\s*(?:test|it)(?:\.only|\.skip|\.fixme|\.fail)?\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/;

// Matches: test.describe('name', ...) | describe('name', ...)
const DESCRIBE_RE =
  /^\s*(?:test\.describe|describe)(?:\.only|\.skip|\.serial|\.parallel)?\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/;

// Matches just the opening of a test/describe call with no name on the same line
const TEST_OPEN_RE = /^\s*(?:test|it)(?:\.only|\.skip|\.fixme|\.fail)?\s*\(\s*$/;
const DESCRIBE_OPEN_RE = /^\s*(?:test\.describe|describe)(?:\.only|\.skip|\.serial|\.parallel)?\s*\(\s*$/;
const STRING_RE = /^\s*(['"`])((?:[^\\]|\\.)*?)\1/;

export function parseTests(document: vscode.TextDocument): TestItem[] {
  const items: TestItem[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    const testMatch = TEST_RE.exec(lineText);
    if (testMatch) {
      items.push({ name: testMatch[2], line: i, kind: 'test', tags: extractTags(testMatch[2]) });
      continue;
    }

    // test( with name on the next line
    if (TEST_OPEN_RE.test(lineText) && i + 1 < document.lineCount) {
      const nextLine = document.lineAt(i + 1).text;
      const nameMatch = STRING_RE.exec(nextLine);
      if (nameMatch) {
        items.push({ name: nameMatch[2], line: i, kind: 'test', tags: extractTags(nameMatch[2]) });
        continue;
      }
    }

    const describeMatch = DESCRIBE_RE.exec(lineText);
    if (describeMatch) {
      items.push({ name: describeMatch[2], line: i, kind: 'describe', tags: extractTags(describeMatch[2]) });
      continue;
    }

    // describe( with name on the next line
    if (DESCRIBE_OPEN_RE.test(lineText) && i + 1 < document.lineCount) {
      const nextLine = document.lineAt(i + 1).text;
      const nameMatch = STRING_RE.exec(nextLine);
      if (nameMatch) {
        items.push({ name: nameMatch[2], line: i, kind: 'describe', tags: extractTags(nameMatch[2]) });
      }
    }
  }

  return items;
}

export function isTestFile(document: vscode.TextDocument): boolean {
  const fileName = document.fileName;
  return (
    /\.(spec|test)\.[cm]?[jt]sx?$/.test(fileName) ||
    fileName.includes('/tests/') ||
    fileName.includes('\\tests\\') ||
    fileName.includes('/e2e/') ||
    fileName.includes('\\e2e\\')
  );
}
