import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { resolveBuildOutputDirectory } from '../build-output';
import { siteFromArgs } from './site-argument';

/**
 * Asserts that a deployed origin is serving *this* build, over plain HTTP.
 *
 * A green deploy only proves the upload succeeded. It says nothing about
 * whether the Worker is actually serving the routes it was built for — which
 * is exactly how production spent four days serving a stale build where every
 * share link, preview image and embed silently fell through to the SPA shell,
 * with no failure anywhere to notice.
 *
 * Each check below is one of those symptoms, turned into an assertion.
 *
 * Parameterised on `--site` so the production deploy and every pull request
 * preview assert the same things. When this lived inline in one workflow, the
 * second caller would have been a copy, and the copy that drifts is the
 * preview one — the one that would have caught the regression first.
 */

const REQUEST_TIMEOUT_MS = 20_000;

/** A share id that cannot exist, so the checks assert routing rather than data. */
const MISSING_SHARE_ID = 'zzzzzzzzzz';

/** How long to wait for Cloudflare to finish propagating the new assets. */
export interface PropagationPolicy {
  attempts: number;
  intervalMs: number;
}

/** 24 tries / 5s apart = up to 2 minutes. See waitFor. */
const DEFAULT_PROPAGATION: PropagationPolicy = { attempts: 24, intervalMs: 5_000 };

export interface DeployedSmokeOptions {
  site: string;
  distDirectory: string;
  /** Shortened by tests, which have no propagation to wait for. */
  propagation?: PropagationPolicy;
}

export function parseArgs(args: readonly string[]): DeployedSmokeOptions {
  const distIndex = args.indexOf('--dist');
  const distValue = distIndex >= 0 ? args[distIndex + 1] : undefined;

  return {
    site: siteFromArgs(args),
    // The same helper vite builds into, so moving the output directory moves
    // this with it rather than silently skipping the build-identity check.
    distDirectory:
      distValue ?? resolveBuildOutputDirectory(resolve(import.meta.dirname, '../..'), false),
  };
}

/**
 * What identifies THIS build: vite fingerprints the entry chunk, so the
 * filename changes whenever the app does. Asserting the live site references
 * the chunk we just built is the difference between "the routes look right"
 * and "this is the build we made" — the stale deployment that prompted all of
 * this had perfectly plausible route shapes, it was simply a different build.
 */
export function entryChunkFrom(indexHtml: string): string | null {
  return /\/assets\/[A-Za-z0-9._-]+\.js/u.exec(indexHtml)?.[0] ?? null;
}

export interface CheckResult {
  label: string;
  url: string;
  want: string;
  got: string;
  ok: boolean;
}

export function formatCheck(result: CheckResult): string {
  return result.ok
    ? `  ok  ${result.label}`
    : `FAIL  ${result.label} — wanted '${result.want}', got '${result.got}' (${result.url})`;
}

/**
 * One response, reduced to the things the assertions ask about.
 *
 * Plain data, not a wrapper around the Response. A request that never
 * completed reports its reason in `status` and `contentType` and leaves the
 * headers empty, so a presence check reads it as absent. Returning the reason
 * from a header getter instead would have made "the request failed" and "the
 * header is there" indistinguishable, and the security-header checks would
 * have passed on a site that never answered.
 */
export interface Probe {
  status: string;
  contentType: string;
  headers: Headers;
}

async function probe(url: string, method: 'GET' | 'HEAD'): Promise<Probe> {
  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Not `follow`. The curl calls this replaced had no -L, so a redirect
      // surfaced as its own 3xx and failed the assertion. Following one would
      // let a route that redirects to something with the right status or
      // content type pass as though it had answered directly.
      redirect: 'manual',
    });
    const probed: Probe = {
      status: String(response.status),
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '',
      headers: new Headers(response.headers),
    };
    // Nothing reads these bodies. Left undrained they hold their connection
    // open, so the step can idle after its last assertion.
    await response.body?.cancel();
    return probed;
  } catch (error: unknown) {
    const reason = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { status: reason, contentType: reason, headers: new Headers() };
  }
}

/** Presence, not an exact count — a header duplicated by some future proxy
 *  rule shouldn't read as "the header is missing". */
function present(probed: Probe, header: string): string {
  return probed.headers.has(header) ? '1' : '0';
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Waits for the new build specifically, not merely for the site to answer.
 * `/` has returned 200 throughout every outage this check exists to catch, so
 * waiting on that would prove nothing.
 *
 * Cloudflare's asset propagation to every edge PoP is a separate, best-effort
 * process that can lag the upload by more than the ~30s six tries used to
 * allow, which produced a false failure for a deploy that was actually fine
 * (confirmed serving the right chunk within ~2 minutes, unassisted). A
 * genuinely stale deploy will not self-correct no matter how long this waits,
 * so widening the window costs nothing but time on the rare slow case.
 */
async function waitFor(
  check: () => Promise<boolean>,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    // Not after the last attempt: the answer is already known, and sleeping on
    // it only delays reporting a failure somebody is waiting for.
    if (attempt < attempts - 1) await sleep(intervalMs);
  }
  return false;
}

async function servesEntryChunk(site: string, entry: string): Promise<boolean> {
  try {
    const response = await fetch(`${site}/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    // Keep the successful observation. A second request can reach a different
    // edge that is still propagating and falsely turn a confirmed deployment
    // back into a failure.
    return (await response.text()).includes(entry);
  } catch {
    // A transient network failure during propagation is not an answer.
    return false;
  }
}

function localEntryChunk(distDirectory: string): string | null {
  try {
    return entryChunkFrom(readFileSync(resolve(distDirectory, 'index.html'), 'utf8'));
  } catch {
    return null;
  }
}

export async function runDeployedSmoke(options: DeployedSmokeOptions): Promise<CheckResult[]> {
  const { site } = options;
  const missing = MISSING_SHARE_ID;
  const results: CheckResult[] = [];

  const expect = (label: string, url: string, want: string, got: string): void => {
    results.push({ label, url, want, got, ok: got === want });
  };

  const { attempts, intervalMs } = options.propagation ?? DEFAULT_PROPAGATION;

  const entry = localEntryChunk(options.distDirectory);
  if (entry) {
    console.log(`expecting entry chunk: ${entry}`);
    const deployed = await waitFor(() => servesEntryChunk(site, entry), attempts, intervalMs);
    expect('the live site serves the build we just made', `${site}/`, '1', deployed ? '1' : '0');
  } else {
    // Deliberately a warning, not a failure. The deploy has already happened
    // by the time this runs, so failing because a local build artifact is
    // missing would report a broken release on the basis of something that
    // says nothing about the release. The shape assertions below still run.
    console.log(
      '::warning::No local build artifact to compare against — skipping the build-identity check.',
    );
    await waitFor(
      async () => (await probe(`${site}/`, 'GET')).status === '200',
      Math.min(attempts, 5),
      intervalMs,
    );
  }

  // One request per URL, all of them at once: the assertions are independent,
  // and two of these URLs are asked about twice.
  const url = {
    shareApi: `${site}/api/systems/${missing}`,
    sharePage: `${site}/s/${missing}`,
    previewImage: `${site}/s/${missing}/preview.png`,
    ogImage: `${site}/og-image.png`,
    manifest: `${site}/manifest.json`,
    embed: `${site}/e/${missing}`,
    root: `${site}/`,
  };
  const [shareApi, sharePage, previewImage, ogImage, manifest, embed, root] = await Promise.all([
    probe(url.shareApi, 'GET'),
    probe(url.sharePage, 'GET'),
    probe(url.previewImage, 'GET'),
    probe(url.ogImage, 'GET'),
    probe(url.manifest, 'GET'),
    probe(url.embed, 'HEAD'),
    probe(url.root, 'HEAD'),
  ]);

  // The Worker runs for /api — a JSON 404, not the SPA shell.
  expect(
    'the API answers unknown shares with JSON',
    url.shareApi,
    'application/json',
    shareApi.contentType,
  );
  expect('the API answers unknown shares with 404', url.shareApi, '404', shareApi.status);

  // The Worker runs for /s — a missing share is 404, not a 200 SPA shell.
  expect('a missing share page is 404, not the SPA shell', url.sharePage, '404', sharePage.status);

  // Preview images are images. Serving HTML here means every pasted link
  // unfurls with a broken card.
  expect('a preview image is a PNG', url.previewImage, 'image/png', previewImage.contentType);
  expect('the site-wide OG image is a PNG', url.ogImage, 'image/png', ogImage.contentType);

  // public/ actually shipped. Asserted on content type, not status: the SPA
  // fallback answers 200 for everything, so a status check passes happily
  // while the file itself is missing.
  expect(
    'the web manifest is JSON, not the SPA fallback',
    url.manifest,
    'application/json',
    manifest.contentType,
  );

  // The Worker runs for /e too. Framing is the discriminator: the Worker
  // serves embeds with `frame-ancestors *` (the one path on the origin any
  // site may frame), while the asset fallback carries `frame-ancestors 'none'`
  // from _headers. Getting 'none' here means the embed prefix never reached
  // Worker code.
  expect(
    'the embed route reaches the Worker',
    url.embed,
    '1',
    (embed.headers.get('content-security-policy') ?? '').toLowerCase().includes('frame-ancestors *')
      ? '1'
      : '0',
  );

  // _headers applied. Without it the editor has no CSP and no HSTS.
  expect(
    'assets carry a Content-Security-Policy',
    url.root,
    '1',
    present(root, 'content-security-policy'),
  );
  expect('assets carry HSTS', url.root, '1', present(root, 'strict-transport-security'));

  for (const result of results) console.log(formatCheck(result));
  return results;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results = await runDeployedSmoke(options);
  if (!results.every((result) => result.ok)) {
    throw new Error(
      `Smoke test failed — ${options.site} is serving something other than this build.`,
    );
  }
  console.log('Smoke test passed.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
