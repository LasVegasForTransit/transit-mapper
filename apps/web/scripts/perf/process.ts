import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { resolveBuildOutputDirectory } from '../build-output';

export const APP_ROOT = resolve(import.meta.dirname, '../..');
export const PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY = resolveBuildOutputDirectory(APP_ROOT, false);
export const PERFORMANCE_HARNESS_OUTPUT_DIRECTORY = resolveBuildOutputDirectory(APP_ROOT, true);

export type PerformancePreviewArtifact = 'public' | 'instrumented';

/**
 * The normal runner always uses this checkout's artifact. A frozen historic
 * baseline supplies both values explicitly so Vite never falls back to the
 * candidate's `dist/` while we are attributing old-app bytes.
 */
export interface PerformancePreviewOptions {
  cwd?: string;
  outputDirectory?: string;
}

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
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
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

export function previewUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Performance preview requires a valid TCP port.');
  }
  return `http://127.0.0.1:${port}`;
}

export function performancePublicBuildArguments(): string[] {
  return ['exec', 'turbo', 'run', 'build', '--filter=@transitmapper/web...', '--concurrency=2'];
}

export function performancePreviewArguments(
  artifact: PerformancePreviewArtifact,
  port: number,
  options: PerformancePreviewOptions = {},
): string[] {
  const outputDirectory =
    options.outputDirectory ??
    (artifact === 'public'
      ? PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY
      : PERFORMANCE_HARNESS_OUTPUT_DIRECTORY);
  return [
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
    '--outDir',
    outputDirectory,
  ];
}

async function allocatePreviewPort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('Could not allocate a performance preview port.'));
        else resolvePromise(port);
      });
    });
  });
}

export async function buildPublicApp(): Promise<void> {
  const publicBuildEnvironment = { ...process.env };
  delete publicBuildEnvironment.VITE_PERF_BUILD;
  await runCommand('pnpm', performancePublicBuildArguments(), publicBuildEnvironment);
}

export async function buildPerformanceApp(): Promise<void> {
  // First-session bytes must come from the public artifact. Keep the private
  // browser seams in a separate output directory so offline/interaction
  // proofs cannot change the files the network ledger measures.
  await buildPublicApp();
  await runCommand(
    'pnpm',
    ['exec', 'vite', 'build', '--outDir', PERFORMANCE_HARNESS_OUTPUT_DIRECTORY],
    {
      ...process.env,
      VITE_PERF_BUILD: '1',
    },
  );
}

export async function assertPerformanceArtifactOutputs(): Promise<void> {
  const required = [
    ['public', PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY],
    ['instrumented', PERFORMANCE_HARNESS_OUTPUT_DIRECTORY],
  ] as const;
  for (const [artifact, outputDirectory] of required) {
    try {
      await access(resolve(outputDirectory, 'index.html'));
    } catch {
      throw new Error(
        `--skip-build requires the ${artifact} performance artifact at ${outputDirectory}. ` +
          'Run the performance command without --skip-build first.',
      );
    }
  }
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

export async function startPreview(
  artifact: PerformancePreviewArtifact,
  options: PerformancePreviewOptions = {},
): Promise<RunningPreview> {
  const port = await allocatePreviewPort();
  const child = spawn('pnpm', performancePreviewArguments(artifact, port, options), {
    cwd: options.cwd ?? APP_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const preview: RunningPreview = { child, url: previewUrl(port), logs: [] };
  child.stdout.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  await waitForPreview(preview);
  return preview;
}

export async function stopPreview(preview: RunningPreview | undefined): Promise<void> {
  if (preview?.child.exitCode !== null) return;
  preview.child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolvePromise) =>
      preview.child.once('exit', () => resolvePromise(true)),
    ),
    new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
  ]);
  if (!exited) preview.child.kill('SIGKILL');
}
