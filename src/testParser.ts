import type * as vscode from 'vscode';

export interface TestItem {
  name: string;
  line: number;
  endLine: number;
  kind: 'test' | 'describe';
  tags: string[];
}

export function extractTags(testName: string): string[] {
  return testName.match(/@[\w-]+/g) ?? [];
}

// Matches: test('name', ...) | test.only('name', ...) | test.skip('name', ...)
// Also matches: it('name', ...) variants
const TEST_RE =
  /^\s*(?:test|it)(?:\.(?:only|skip|fixme|fail))*\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/;

// Matches: test.describe('name', ...) | describe('name', ...)
const DESCRIBE_RE =
  /^\s*(?:test\.describe|describe)(?:\.(?:only|skip|fixme|serial|parallel))*\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1/;

// Matches just the opening of a test/describe call with no name on the same line
const TEST_OPEN_RE = /^\s*(?:test|it)(?:\.(?:only|skip|fixme|fail))*\s*\(\s*$/;
const DESCRIBE_OPEN_RE = /^\s*(?:test\.describe|describe)(?:\.(?:only|skip|fixme|serial|parallel))*\s*\(\s*$/;
const STRING_RE = /^\s*(['"`])((?:[^\\]|\\.)*?)\1/;

function callEndLine(document: vscode.TextDocument, startLine: number): number {
  let depth = 0;
  let started = false;
  let quote: "'" | '"' | '`' | '/' | undefined;
  let escaped = false;
  let blockComment = false;
  let previousCode = '';

  for (let line = startLine; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    let lineComment = false;
    for (let column = 0; column < text.length; column++) {
      const char = text[column];
      const next = text[column + 1];
      if (lineComment) break;
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false;
          column++;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote || (quote === '/' && char === '/')) quote = undefined;
        continue;
      }
      if (char === '/' && next === '/') {
        lineComment = true;
        continue;
      }
      if (char === '/' && next === '*') {
        blockComment = true;
        column++;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '/' && /[=([{,:;!&|?]/.test(previousCode || '=')) {
        quote = '/';
        continue;
      }
      if (char === '(') {
        depth++;
        started = true;
      } else if (char === ')' && started && --depth === 0) {
        return line;
      }
      if (!/\s/.test(char)) previousCode = char;
    }
  }
  return startLine;
}

function callText(document: vscode.TextDocument, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (let line = startLine; line <= endLine; line++) lines.push(document.lineAt(line).text);
  return lines.join('\n');
}

export function extractDetailTags(declaration: string): string[] {
  const callbackAt = declaration.indexOf('=>');
  const header = callbackAt >= 0 ? declaration.slice(0, callbackAt) : declaration;
  const tags = new Set<string>();
  const property = /\btag\s*:\s*(?:(['"`])((?:\\.|[^\\])*?)\1|\[([\s\S]*?)\])/g;
  for (const match of header.matchAll(property)) {
    if (match[2] !== undefined) {
      for (const tag of extractTags(match[2])) tags.add(tag);
    } else {
      for (const literal of (match[3] ?? '').matchAll(/(['"`])((?:\\.|[^\\])*?)\1/g)) {
        for (const tag of extractTags(literal[2])) tags.add(tag);
      }
    }
  }
  return [...tags];
}

function item(
  document: vscode.TextDocument,
  name: string,
  line: number,
  kind: TestItem['kind']
): TestItem {
  const endLine = callEndLine(document, line);
  return {
    name,
    line,
    endLine,
    kind,
    tags: [...new Set([...extractTags(name), ...extractDetailTags(callText(document, line, endLine))])],
  };
}

export function parseTests(document: vscode.TextDocument): TestItem[] {
  const items: TestItem[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text;

    const testMatch = TEST_RE.exec(lineText);
    if (testMatch) {
      items.push(item(document, testMatch[2], i, 'test'));
      continue;
    }

    // test( with name on the next line
    if (TEST_OPEN_RE.test(lineText) && i + 1 < document.lineCount) {
      const nextLine = document.lineAt(i + 1).text;
      const nameMatch = STRING_RE.exec(nextLine);
      if (nameMatch) {
        items.push(item(document, nameMatch[2], i, 'test'));
        continue;
      }
    }

    const describeMatch = DESCRIBE_RE.exec(lineText);
    if (describeMatch) {
      items.push(item(document, describeMatch[2], i, 'describe'));
      continue;
    }

    // describe( with name on the next line
    if (DESCRIBE_OPEN_RE.test(lineText) && i + 1 < document.lineCount) {
      const nextLine = document.lineAt(i + 1).text;
      const nameMatch = STRING_RE.exec(nextLine);
      if (nameMatch) {
        items.push(item(document, nameMatch[2], i, 'describe'));
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

export function findTestAtLine(items: TestItem[], line: number): TestItem | undefined {
  return [...items].reverse().find(
    item => item.kind === 'test' && item.line <= line && item.endLine >= line
  );
}
