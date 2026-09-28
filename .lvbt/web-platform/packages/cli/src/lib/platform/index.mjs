import path from 'node:path';
import { CliError } from '../arguments.mjs';
import { applyPlan, rotateSecrets } from './apply.mjs';
import { setupTokenGuide } from './guides.mjs';
import { findManifests, loadManifest, MANIFEST_FILE } from './manifest.mjs';
import { observePlatform } from './observe.mjs';
import { planPlatform, readiness, SETUP } from './plan.mjs';
import { formatReport } from './report.mjs';
import {
  cloudflareApi,
  confirmationStore,
  dnsResolver,
  memoryConfirmations,
  runCommand,
  wranglerToken,
} from './services.mjs';
import { paint, terminalIo } from './terminal.mjs';

/**
 * `lvbt preflight --production` and `lvbt bootstrap --production`: read a
 * repository's platform manifests, report whether production has everything
 * they declare, and (for bootstrap) set up what is missing.
 */

export const SETUP_TOKEN_VARIABLE = 'LVBT_CLOUDFLARE_SETUP_TOKEN';

export function defaultServices() {
  return {
    run: runCommand,
    request: fetch,
    env: process.env,
    confirmations: confirmationStore(),
  };
}

/** The manifests `--filter` selects: `apps/site`, `site`, or `.` for the root. */
export function selectManifests(cwd, filter) {
  const all = findManifests(cwd);
  if (all.length === 0)
    throw new CliError(
      `No ${MANIFEST_FILE} at the root or under apps/. Add one to declare what production needs; see docs/reference/platform-manifest.md in repository-tooling.`,
      2,
    );
  if (!filter) return all;
  const target = filter.replace(/\/+$/, '');
  const wanted = all.filter((file) => [target, `apps/${target}`].includes(path.dirname(file)));
  if (wanted.length === 0)
    throw new CliError(
      `No ${MANIFEST_FILE} matches --filter ${filter}. Found: ${all.join(', ')}.`,
      2,
    );
  return wanted;
}

function setupApiProvider({ manifest, services, io, interactive }) {
  let api;
  let declined = false;
  return async () => {
    if (api) return api;
    const fromEnvironment = services.env[SETUP_TOKEN_VARIABLE];
    if (fromEnvironment) {
      api = cloudflareApi(fromEnvironment, services.request);
      return api;
    }
    if (declined || !interactive) return undefined;
    const guide = setupTokenGuide(manifest);
    io.write(`\n${paint('bold', 'A Cloudflare API token for Turnstile and Access')}\n`);
    io.write(
      `Wrangler's sign-in cannot read or manage Turnstile widgets or Access applications, so checking them needs a short-lived token, even when they are already set up. It stays in this terminal's memory and is never written to disk. To skip this question next time, put the token in ${SETUP_TOKEN_VARIABLE} for the length of your session.\n`,
    );
    io.write(`Open: ${paint('cyan', guide.url)}\n`);
    guide.steps.forEach((step, index) => io.write(`  ${index + 1}. ${step}\n`));
    if (await io.confirm('Open that page in your browser?', true)) io.open(guide.url);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = await io.askHidden(
        'Paste the token (hidden; leave empty to skip Turnstile and Access for now): ',
      );
      if (!token) break;
      const candidate = cloudflareApi(token, services.request);
      try {
        // A user token verifies here; an account-owned token verifies under its account.
        await candidate
          .get('user/tokens/verify')
          .catch(() => candidate.get(`accounts/${manifest.cloudflare.accountId}/tokens/verify`));
        api = candidate;
        return api;
      } catch (error) {
        io.write(`That token did not work (${error.message}). Check that you copied all of it.\n`);
      }
    }
    declined = true;
    return undefined;
  };
}

async function inspect({ cwd, file, services, io, interactive, askForToken }) {
  const manifest = loadManifest(path.join(cwd, file));
  const directory = path.join(cwd, path.dirname(file));
  const configPath = path.join(
    path.dirname(file),
    manifest.cloudflare.wranglerConfig ?? 'wrangler.jsonc',
  );
  const signedIn = wranglerToken(services.run, directory);
  const setupApi = setupApiProvider({ manifest, services, io, interactive });
  const apis = {
    wrangler: signedIn.token ? cloudflareApi(signedIn.token, services.request) : undefined,
    wranglerMissing: signedIn.reason,
    setup: services.env[SETUP_TOKEN_VARIABLE] ? await setupApi() : undefined,
  };
  const resolve = dnsResolver(services.request);
  const confirmations = services.confirmations ?? memoryConfirmations();
  const observe = () =>
    observePlatform({
      manifest,
      directory,
      apis,
      run: services.run,
      resolve,
      confirmed: confirmations.read(),
    });
  let state = await observe();
  const needsToken = [state.turnstile, state.access].some(
    (part) => !part.ok && part.kind === 'unauthorized',
  );
  if (needsToken && askForToken && !apis.setup) {
    apis.setup = await setupApi();
    if (apis.setup) state = await observe();
  }
  const plan = () => planPlatform({ manifest, state, configPath });
  return {
    manifest,
    directory,
    configPath,
    title: `${manifest.name} production (${file})`,
    items: plan(),
    setupApi,
    confirmations,
    refresh: async () => {
      state = await observe();
      return { state, items: plan() };
    },
    get state() {
      return state;
    },
  };
}

/** Read-only: print each manifest's readiness report. Fails when a required item is not ready. */
export async function platformPreflight({
  cwd,
  options,
  services = defaultServices(),
  io = terminalIo(),
}) {
  let failed = 0;
  for (const file of selectManifests(cwd, options.filter)) {
    const view = await inspect({
      cwd,
      file,
      services,
      io,
      interactive: io.interactive,
      askForToken: io.interactive,
    });
    io.write(`\n${formatReport({ title: view.title, items: view.items })}`);
    if (!readiness(view.items).ready) failed += 1;
  }
  if (failed > 0)
    throw new CliError(
      `preflight --production: production is not ready. Run ${SETUP} to fix what it can.`,
      1,
    );
}

/**
 * The secrets `--rotate` names, checked against the manifests it applies to.
 * Rotating is never implied: without the flag, a stored value is kept.
 */
export function rotationNames(option, manifests) {
  if (option === undefined) return [];
  const names = [
    ...new Set(
      String(option)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length === 0)
    throw new CliError('--rotate needs the name of a secret, such as --rotate SIGNING_SECRET.', 2);
  const declared = new Set(
    manifests.flatMap((manifest) => (manifest.secrets ?? []).map((secret) => secret.name)),
  );
  const unknownNames = names.filter((name) => !declared.has(name));
  if (unknownNames.length > 0)
    throw new CliError(
      `--rotate names ${unknownNames.join(', ')}, which platform.json does not declare as a secret.`,
      2,
    );
  return names;
}

/** Set up everything each manifest declares, then report what is still open. */
export async function platformBootstrap({
  cwd,
  options,
  services = defaultServices(),
  io = terminalIo(),
}) {
  if (!io.interactive)
    throw new CliError(
      `${SETUP} asks for values, so it needs a terminal. To check production without changing it, run pnpm preflight --production.`,
      2,
    );
  const files = selectManifests(cwd, options.filter);
  const rotate = rotationNames(
    options.rotate,
    files.map((file) => loadManifest(path.join(cwd, file))),
  );
  let failed = 0;
  for (const file of files) {
    const view = await inspect({ cwd, file, services, io, interactive: true, askForToken: true });
    io.write(`\n${formatReport({ title: view.title, items: view.items })}`);
    const context = {
      manifest: view.manifest,
      directory: view.directory,
      configPath: view.configPath,
      state: view.state,
      run: services.run,
      io,
      setupApi: view.setupApi,
      confirmations: view.confirmations,
      values: new Map(),
      handled: new Set(),
      shown: new Set(),
      created: { widgets: new Map(), apps: new Map() },
      observe: async () => (await view.refresh()).state,
    };
    const declared = new Set((view.manifest.secrets ?? []).map((secret) => secret.name));
    const mine = rotate.filter((name) => declared.has(name));
    let acted;
    try {
      ({ acted } = await applyPlan(context, view.items));
      if (mine.length > 0) await rotateSecrets(context, mine);
    } finally {
      context.values.clear();
    }
    // Nothing was done, so the report above is still the current one.
    if (!acted && mine.length === 0) {
      if (!readiness(view.items).ready) failed += 1;
      continue;
    }
    const after = await view.refresh();
    io.write(`\n${formatReport({ title: `${view.title}, after setup`, items: after.items })}`);
    if (!readiness(after.items).ready) failed += 1;
  }
  if (failed > 0)
    throw new CliError(
      `bootstrap --production: some items are still open. Finish the steps above, then run ${SETUP} again; it picks up where it stopped.`,
      1,
    );
}
