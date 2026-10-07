import { execFile, ChildProcess } from 'child_process';

function running(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** Stop probe descendants before their parent can orphan a server process. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!running(child)) return;
  const pid = child.pid!;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      try {
        execFile(
          'taskkill',
          ['/pid', String(pid), '/T', '/F'],
          { timeout: 5000, windowsHide: true },
          () => {
            if (running(child)) child.kill('SIGKILL');
            resolve();
          },
        );
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* Already stopped or unavailable. */
        }
        resolve();
      }
    });
    return;
  }

  const processList = await new Promise<string>((resolve) => {
    try {
      execFile(
        'ps',
        ['-A', '-o', 'pid=,ppid='],
        { timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          resolve(error ? '' : stdout);
        },
      );
    } catch {
      resolve('');
    }
  });
  // The child may exit while ps runs. Do not signal a reused PID.
  if (!running(child)) return;
  const childrenByParent = new Map<number, number[]>();
  for (const line of processList.trim().split('\n')) {
    const [childPid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isSafeInteger(childPid) || childPid <= 0 || !Number.isSafeInteger(parentPid))
      continue;
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(childPid);
    childrenByParent.set(parentPid, children);
  }
  const descendants = [pid];
  const visited = new Set(descendants);
  for (let index = 0; index < descendants.length; index++) {
    for (const childPid of childrenByParent.get(descendants[index]) ?? []) {
      if (!visited.has(childPid)) {
        visited.add(childPid);
        descendants.push(childPid);
      }
    }
  }
  for (const descendant of descendants.reverse()) {
    try {
      process.kill(descendant, 'SIGKILL');
    } catch {
      /* The process already exited. */
    }
  }
}
