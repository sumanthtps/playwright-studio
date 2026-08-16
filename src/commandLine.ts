export interface CommandInvocation {
  executable: string;
  args: string[];
}

/**
 * Parse the configured command without invoking a shell. This deliberately
 * supports quoting and escaping, but not shell operators or expansion.
 */
export function parseCommandLine(command: string): CommandInvocation {
  const tokens: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | undefined;
  let tokenStarted = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote === 'single') {
      if (char === "'") quote = undefined;
      else token += char;
      tokenStarted = true;
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = undefined;
      } else if (char === '\\' && i + 1 < command.length && command[i + 1] === '"') {
        token += command[++i];
      } else {
        token += char;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }

    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
    } else if (char === '"') {
      quote = 'double';
      tokenStarted = true;
    } else if (char === '\\' && i + 1 < command.length && /\s/.test(command[i + 1])) {
      token += command[++i];
      tokenStarted = true;
    } else {
      token += char;
      tokenStarted = true;
    }
  }

  if (quote) throw new Error('The Playwright test command contains an unterminated quote.');
  if (tokenStarted) tokens.push(token);
  if (tokens.length === 0) throw new Error('The Playwright test command is empty.');

  return { executable: tokens[0], args: tokens.slice(1) };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
