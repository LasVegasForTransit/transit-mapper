import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const APP_ROOT = resolve(import.meta.dirname, '../..');
export const PREVIEW_PORT = 4_173;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const BUILD_REPORT_DIRECTORY = resolve(APP_ROOT, 'dist/performance');
const BUILD_REPORT_PATHS = ['bundle-report.json', 'pwa-report.json'].map((filename) =>
  resolve(BUILD_REPORT_DIRECTORY, filename),
);

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
  // Gate and capture the graph that actually ships before adding the private
  // browser instrumentation. Otherwise the harness grades its own code as
  // production payload and can fail a delivery budget before Chrome starts.
  await runCommand('pnpm', ['run', 'build'], process.env);
  const productionReports = new Map(
    await Promise.all(
      BUILD_REPORT_PATHS.map(async (path) => [path, await readFile(path)] as const),
    ),
  );

  await runCommand('pnpm', ['exec', 'vite', 'build'], {
    ...process.env,
    VITE_PERF_BUILD: '1',
  });

  // Vite empties dist/ for the instrumented build. Restore the production
  // delivery evidence so reports and --skip-build continue to describe the
  // public artifact while preview serves the instrumented one.
  await mkdir(BUILD_REPORT_DIRECTORY, { recursive: true });
  await Promise.all([...productionReports].map(([path, contents]) => writeFile(path, contents)));
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
