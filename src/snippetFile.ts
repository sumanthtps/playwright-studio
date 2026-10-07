import {
  applyEdits,
  modify,
  parse,
  ParseError,
  printParseErrorCode,
} from 'jsonc-parser/lib/esm/main';

export interface CustomSnippet {
  prefix: string;
  body: string[];
  description: string;
  scope: string;
}

export function parseSnippetFile(content: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(errors.map(error => printParseErrorCode(error.error)).join(', '));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The top-level value must be an object.');
  }
  return value as Record<string, unknown>;
}

export function upsertSnippet(
  content: string,
  name: string,
  snippet: CustomSnippet
): string {
  const updated = applyEdits(
    content,
    modify(content, [name], snippet, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    })
  );
  return updated.endsWith('\n') ? updated : `${updated}\n`;
}
