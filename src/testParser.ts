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

const CALL_RE = /(?<![\w$.])((?:test\.describe|describe)(?:\.(?:only|skip|fixme|serial|parallel))*|(?:test|it)(?:\.(?:only|skip|fixme|fail))*)\s*\(/g;

function regexCanStartAfter(previousCode: string): boolean {
  return /[=([{,:;!&|?+*%^~<>-]/.test(previousCode || '=');
}

/** Mask non-code while preserving offsets and newlines. */
function maskNonCode(source: string): string {
  // split('') preserves UTF-16 offsets used by VS Code; a code-point spread
  // would shift offsets after emoji and other astral characters.
  const output = source.split('');
  let state: 'code' | 'single' | 'double' | 'template' | 'regex' | 'lineComment' | 'blockComment' = 'code';
  let escaped = false;
  let regexClass = false;
  let previousCode = '';

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'lineComment') {
      if (char === '\n' || char === '\r') state = 'code';
      else output[i] = ' ';
      continue;
    }

    if (state === 'blockComment') {
      if (char !== '\n' && char !== '\r') output[i] = ' ';
      if (char === '*' && next === '/') {
        output[i + 1] = ' ';
        state = 'code';
        i++;
      }
      continue;
    }

    if (state !== 'code') {
      if (char !== '\n' && char !== '\r') output[i] = ' ';
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (state === 'regex') {
        if (char === '[') regexClass = true;
        else if (char === ']') regexClass = false;
        else if (char === '/' && !regexClass) state = 'code';
      } else if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      output[i] = output[i + 1] = ' ';
      state = 'lineComment';
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      output[i] = output[i + 1] = ' ';
      state = 'blockComment';
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      output[i] = ' ';
      state = char === "'" ? 'single' : char === '"' ? 'double' : 'template';
      continue;
    }
    if (char === '/' && regexCanStartAfter(previousCode)) {
      output[i] = ' ';
      state = 'regex';
      regexClass = false;
      continue;
    }
    if (!/\s/.test(char)) previousCode = char;
  }

  return output.join('');
}

function skipTrivia(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) i++;
    else if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i + 2);
      i = newline < 0 ? source.length : newline + 1;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else break;
  }
  return i;
}

function readString(source: string, start: number): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;
  let escaped = false;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === quote) return { value: source.slice(start + 1, i), end: i + 1 };
  }
  return undefined;
}

function matchingCallEnd(masked: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')' && --depth === 0) return i;
  }
  return openParen;
}

function matchingSquareBracket(masked: string, openBracket: number): number | undefined {
  let depth = 0;
  for (let i = openBracket; i < masked.length; i++) {
    if (masked[i] === '[') depth++;
    else if (masked[i] === ']' && --depth === 0) return i;
  }
  return undefined;
}

function stringLiterals(source: string, start: number, end: number): string[] {
  const values: string[] = [];
  for (let i = start; i < end;) {
    const next = skipTrivia(source, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const literal = readString(source, i);
    if (literal) {
      values.push(literal.value);
      i = literal.end;
    } else i++;
  }
  return values;
}

export function extractDetailTags(declaration: string): string[] {
  const masked = maskNonCode(declaration);
  const callbackAt = masked.indexOf('=>');
  const headerEnd = callbackAt >= 0 ? callbackAt : declaration.length;
  const headerMask = masked.slice(0, headerEnd);
  const tags = new Set<string>();
  const property = /\btag\s*:/g;

  for (const match of headerMask.matchAll(property)) {
    const colon = match.index! + match[0].lastIndexOf(':');
    const valueStart = skipTrivia(declaration, colon + 1);
    const literal = readString(declaration, valueStart);
    if (literal) {
      for (const tag of extractTags(literal.value)) tags.add(tag);
      continue;
    }
    if (declaration[valueStart] !== '[') continue;
    const arrayEnd = matchingSquareBracket(masked, valueStart);
    if (arrayEnd === undefined || arrayEnd > headerEnd) continue;
    for (const value of stringLiterals(declaration, valueStart + 1, arrayEnd)) {
      for (const tag of extractTags(value)) tags.add(tag);
    }
  }
  return [...tags];
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAtOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

export function parseTests(document: vscode.TextDocument): TestItem[] {
  const source = document.getText();
  const masked = maskNonCode(source);
  const starts = lineStarts(source);
  const items: TestItem[] = [];

  CALL_RE.lastIndex = 0;
  for (const match of masked.matchAll(CALL_RE)) {
    const callName = match[1];
    const openParen = match.index! + match[0].lastIndexOf('(');
    const title = readString(source, skipTrivia(source, openParen + 1));
    if (!title) continue;

    const endOffset = matchingCallEnd(masked, openParen);
    const line = lineAtOffset(starts, match.index!);
    const endLine = lineAtOffset(starts, endOffset);
    const kind: TestItem['kind'] = callName.startsWith('test.describe') || callName.startsWith('describe')
      ? 'describe'
      : 'test';
    const declaration = source.slice(match.index!, endOffset + 1);
    items.push({
      name: title.value,
      line,
      endLine,
      kind,
      tags: [...new Set([...extractTags(title.value), ...extractDetailTags(declaration)])],
    });
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
