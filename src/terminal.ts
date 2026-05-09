import * as vscode from 'vscode';
import { getConfig, getCaptureEnv } from './config';

let terminal: vscode.Terminal | undefined;
let extraEnvProvider: (() => Record<string, string>) | undefined;

function isAlive(t: vscode.Terminal): boolean {
  return vscode.window.terminals.includes(t);
}

export function setExtraEnvProvider(fn: () => Record<string, string>): void {
  extraEnvProvider = fn;
  // Dispose so the next run recreates it with updated env
  disposeTerminal();
}

export function getTerminal(): vscode.Terminal {
  if (terminal && isAlive(terminal)) {
    return terminal;
  }
  const { workingDirectory, env } = getConfig();
  const profileEnv = extraEnvProvider?.() ?? {};
  const captureEnv = getCaptureEnv();
  terminal = vscode.window.createTerminal({
    name: 'Playwright',
    cwd: workingDirectory,
    env: { ...env, ...profileEnv, ...captureEnv },
  });
  return terminal;
}

export function runInTerminal(command: string, extraEnv?: Record<string, string>): void {
  const term = getTerminal();

  if (extraEnv && Object.keys(extraEnv).length > 0) {
    const envStr = Object.entries(extraEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    term.sendText(`${envStr} ${command}`);
  } else {
    term.sendText(command);
  }

  term.show(true);
}

export function disposeTerminal(): void {
  if (terminal && isAlive(terminal)) {
    terminal.dispose();
  }
  terminal = undefined;
}
