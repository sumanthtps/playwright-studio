export interface ParsedFixtureDef {
  name: string;
  line: number;
  column: number;
}

interface LexState {
  quote?: "'" | '"' | '`';
  blockComment: boolean;
  escaped: boolean;
}

function maskNonCode(line: string, state: LexState): string {
  const output = [...line];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (state.blockComment) {
      output[i] = ' ';
      if (char === '*' && next === '/') {
        output[i + 1] = ' ';
        state.blockComment = false;
        i++;
      }
      continue;
    }

    if (state.quote) {
      output[i] = ' ';
      if (state.escaped) {
        state.escaped = false;
      } else if (char === '\\') {
        state.escaped = true;
      } else if (char === state.quote) {
        state.quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      for (let j = i; j < line.length; j++) output[j] = ' ';
      break;
    }
    if (char === '/' && next === '*') {
      output[i] = output[i + 1] = ' ';
      state.blockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      output[i] = ' ';
      state.quote = char;
    }
  }
  state.escaped = false;
  return output.join('');
}

function braceDelta(code: string): number {
  let delta = 0;
  for (const char of code) {
    if (char === '{') delta++;
    else if (char === '}') delta--;
  }
  return delta;
}

export function extractFixtureDefinitions(text: string): ParsedFixtureDef[] {
  const definitions: ParsedFixtureDef[] = [];
  const state: LexState = { blockComment: false, escaped: false };
  const lines = text.split(/\r?\n/);
  let awaitingCall = false;
  let awaitingBody = false;
  let inBody = false;
  let depth = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const original = lines[lineNumber];
    const code = maskNonCode(original, state);
    let bodyContentStart = 0;

    if (!inBody) {
      const extendAt = code.indexOf('.extend');
      if (extendAt >= 0) awaitingCall = true;

      if (awaitingCall) {
        const callAt = code.indexOf('(', extendAt >= 0 ? extendAt + '.extend'.length : 0);
        if (callAt >= 0) {
          awaitingCall = false;
          awaitingBody = true;
          const bodyAt = code.indexOf('{', callAt + 1);
          if (bodyAt >= 0) {
            awaitingBody = false;
            inBody = true;
            depth = 1;
            bodyContentStart = bodyAt + 1;
          }
        }
      } else if (awaitingBody) {
        const bodyAt = code.indexOf('{');
        if (bodyAt >= 0) {
          awaitingBody = false;
          inBody = true;
          depth = 1;
          bodyContentStart = bodyAt + 1;
        }
      }
    }

    if (!inBody) continue;

    const originalBody = original.slice(bodyContentStart);
    const codeBody = code.slice(bodyContentStart);
    if (depth === 1) {
      const match = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(codeBody);
      if (match) {
        const column = bodyContentStart + originalBody.indexOf(match[1]);
        definitions.push({ name: match[1], line: lineNumber, column });
      }
    }

    depth += braceDelta(codeBody);
    if (depth <= 0) {
      inBody = false;
      depth = 0;
    }
  }

  return definitions;
}
