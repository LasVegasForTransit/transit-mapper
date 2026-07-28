import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

export const APP_ROOT = resolve(import.meta.dirname, '../..');
export const PREVIEW_PORT = 4_173;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

export interface RunningPreview {
  child: ChildProcess;
  url: string;
  logs: string[];
}

function commandError(command: string, code: number | null, output: string): Error {
  const detail = output.trim();
  return new Error(`${command} exited with ${code ?? 'no status'}${detail ? `:\n${detail}` : '.'}`);
}

async function runCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: APP_ROOT,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(commandError([command, ...args].join(' '), code, output));
    });
  });
}

export async function buildPerformanceApp(): Promise<void> {
  await runCommand('pnpm', ['run', 'build'], {
    ...process.env,
    VITE_PERF_BUILD: '1',
  });
}

async function waitForPreview(preview: RunningPreview): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.child.exitCode !== null) {
      throw commandError('vite preview', preview.child.exitCode, preview.logs.join(''));
    }
    try {
      const response = await fetch(preview.url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`vite preview did not answer at ${preview.url} within 15 seconds.`);
}

export async function startPreview(): Promise<RunningPreview> {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ],
    {
      cwd: APP_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const preview: RunningPreview = { child, url: PREVIEW_URL, logs: [] };
  child.stdout?.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  await waitForPreview(preview);
  return preview;
}

export async function stopPreview(preview: RunningPreview | undefined): Promise<void> {
  if (!preview || preview.child.exitCode !== null) return;
  preview.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolvePromise) => preview.child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (preview.child.exitCode === null) preview.child.kill('SIGKILL');
}
