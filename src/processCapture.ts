import type { SpawnOptions } from 'child_process';
import { CommandInvocation } from './commandLine';
import { terminateProcessTree } from './processTree';

// cross-spawn handles Windows command shims and quotes each argument separately.
const spawn: typeof import('child_process').spawn = require('cross-spawn');

export interface CapturedProcess {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

/** CLI probes cannot wait for stdin or keep the extension alive indefinitely. */
export function captureProcess(
  command: CommandInvocation,
  options: Pick<SpawnOptions, 'cwd' | 'env'>,
  timeoutMs = 15_000,
  maxBytes = 250_000,
): Promise<CapturedProcess> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command.executable, command.args, {
        ...options,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: '', error: String(error) });
      return;
    }
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      finished = false;
    const finish = (ok: boolean, error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        ok,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        error,
      });
    };
    let stopReason: string | undefined;
    const stop = (reason: string) => {
      if (stopReason) return;
      stopReason = reason;
      void terminateProcessTree(child).finally(() => finish(false, reason));
    };
    const append = (chunks: Buffer[], chunk: Buffer) => {
      if (finished || stopReason) return;
      const remaining = maxBytes - bytes;
      chunks.push(chunk.subarray(0, Math.max(0, remaining)));
      bytes += chunk.length;
      if (bytes > maxBytes) stop(`Command output exceeds ${maxBytes} bytes.`);
    };
    const timer = setTimeout(() => stop('Timed out'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => append(stderr, chunk));
    child.once('error', (error) => finish(false, error.message));
    child.once('close', (code) => finish(!stopReason && code === 0, stopReason));
  });
}
