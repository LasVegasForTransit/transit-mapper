import path from 'node:path';
import { emailRecords } from './guides.mjs';
import { migrationFiles, readWranglerConfig } from './manifest.mjs';

/**
 * Read everything the manifest names, without changing anything. Each part
 * is either `{ ok: true, value }` or `{ ok: false, reason, kind }`, so one
 * unreadable service leaves the rest of the report intact.
 */

export const known = (value) => ({ ok: true, value });
export const unknown = (reason, kind = 'error') => ({ ok: false, reason, kind });

async function attempt(read) {
  try {
    return known(await read());
  } catch (error) {
    return unknown(error.message, error.kind ?? 'error');
  }
}

const SQL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function githubEnvironments(manifest) {
  const targets = [
    ...(manifest.secrets ?? []).flatMap((secret) => secret.targets ?? []),
    ...(manifest.forbidden ?? []).flatMap((entry) => entry.targets ?? []),
  ];
  return [
    ...new Set(
      targets.filter((target) => target.startsWith('github:')).map((target) => target.slice(7)),
    ),
  ];
}

async function observeWorker(api, account, name) {
  if (!api.client) return api.missing;
  return attempt(async () => {
    let settings;
    try {
      settings = await api.client.get(`${account}/workers/scripts/${name}/settings`);
    } catch (error) {
      if (error.kind === 'not-found') return { exists: false, secrets: [], vars: {} };
      throw error;
    }
    const secrets = await api.client.get(`${account}/workers/scripts/${name}/secrets`);
    const vars = {};
    for (const binding of settings?.bindings ?? []) {
      if (binding.type === 'plain_text' || binding.type === 'json')
        vars[binding.name] = binding.text ?? binding.json;
    }
    return { exists: true, secrets: (secrets ?? []).map((secret) => secret.name), vars };
  });
}

async function observeD1(api, account, manifest, config) {
  if (!manifest.d1?.length) return known({});
  if (!api.client) return api.missing;
  return attempt(async () => {
    const databases = await api.client.list(`${account}/d1/database`);
    const found = {};
    for (const database of manifest.d1) {
      const match = databases.find((candidate) => candidate.name === database.name);
      if (!match) continue;
      const entry = { id: match.uuid };
      if (database.migrations) {
        const table =
          config?.d1.find((item) => item.name === database.name)?.migrationsTable ??
          'd1_migrations';
        entry.applied = SQL_NAME.test(table)
          ? await attempt(async () => {
              try {
                const [result] = await api.client.post(
                  `${account}/d1/database/${match.uuid}/query`,
                  {
                    sql: `SELECT name FROM ${table} ORDER BY id`,
                  },
                );
                return (result?.results ?? []).map((row) => row.name);
              } catch (error) {
                if (/no such table/i.test(error.message)) return [];
                throw error;
              }
            })
          : unknown(`The migrations table name "${table}" is not a plain SQL name.`);
      }
      found[database.name] = entry;
    }
    return found;
  });
}

async function observeAccess(api, account) {
  if (!api.client) return api.missing;
  try {
    const apps = await api.client.list(`${account}/access/apps`);
    const [organization, providers, policies] = await Promise.all([
      api.client.get(`${account}/access/organizations`),
      api.client.list(`${account}/access/identity_providers`),
      api.client.list(`${account}/access/policies`),
    ]);
    return known({
      enabled: true,
      teamDomain: organization?.auth_domain,
      teamName: organization?.name,
      providers: providers.map((provider) => ({
        id: provider.id,
        type: provider.type,
        name: provider.name,
      })),
      apps,
      policies,
    });
  } catch (error) {
    if (error.kind === 'not-enabled')
      return known({ enabled: false, providers: [], apps: [], policies: [] });
    return unknown(error.message, error.kind ?? 'error');
  }
}

/**
 * The declared buckets that exist. Each is looked up by name: the bucket list
 * is paged by cursor, so a bucket past its first page would look missing.
 */
async function observeR2(api, account, manifest) {
  if (!api.client) return api.missing;
  return attempt(async () => {
    const found = [];
    for (const bucket of manifest.r2) {
      try {
        await api.client.get(`${account}/r2/buckets/${encodeURIComponent(bucket.name)}`);
        found.push(bucket.name);
      } catch (error) {
        if (error.kind !== 'not-found') throw error;
      }
    }
    return found;
  });
}

function githubRead(run, cwd, args) {
  const result = run('gh', args, { cwd });
  if (result.status === 0) return { ok: true, stdout: result.stdout };
  const missing = /HTTP 404|Not Found/i.test(result.stderr);
  return { ok: false, missing, reason: result.stderr.trim().split('\n')[0] || 'gh failed' };
}

async function observeGithub(run, cwd, manifest) {
  const environments = githubEnvironments(manifest);
  if (environments.length === 0) return known({ environments: [], secrets: {} });
  const repository = manifest.github.repository;
  const value = { environments: [], secrets: {} };
  for (const environment of environments) {
    const exists = githubRead(run, cwd, ['api', `repos/${repository}/environments/${environment}`]);
    if (!exists.ok && !exists.missing) return unknown(`gh: ${exists.reason}`, 'unauthorized');
    if (!exists.ok) continue;
    value.environments.push(environment);
    const listed = githubRead(run, cwd, [
      'secret',
      'list',
      '--env',
      environment,
      '--repo',
      repository,
      '--json',
      'name',
    ]);
    if (!listed.ok) return unknown(`gh: ${listed.reason}`, 'unauthorized');
    value.secrets[environment] = JSON.parse(listed.stdout).map((secret) => secret.name);
  }
  return known(value);
}

async function observeDns(resolve, manifest) {
  const answers = {};
  for (const email of manifest.email ?? []) {
    for (const record of emailRecords(email)) {
      const key = `${record.name} ${record.type}`;
      answers[key] ??= await attempt(() => resolve(record.name, record.type));
    }
  }
  return answers;
}

/**
 * @param {object} input
 * @param {object} input.manifest a validated manifest
 * @param {string} input.directory the manifest's directory, absolute
 * @param {{ wrangler?: object, setup?: object }} input.apis Cloudflare clients
 * @param {Function} input.run the command runner
 * @param {Function} input.resolve the DNS resolver
 * @param {Set<string>} [input.confirmed] what a person has confirmed on this computer
 */
export async function observePlatform({ manifest, directory, apis, run, resolve, confirmed }) {
  const account = `accounts/${manifest.cloudflare.accountId}`;
  const configFile = path.join(directory, manifest.cloudflare.wranglerConfig ?? 'wrangler.jsonc');
  const config = await attempt(() => readWranglerConfig(configFile));
  const migrations = {};
  for (const database of manifest.d1 ?? []) {
    if (database.migrations)
      migrations[database.name] = await attempt(() =>
        migrationFiles(path.join(directory, database.migrations)),
      );
  }
  // Workers, D1 and R2 read with Wrangler's own sign-in. Turnstile and Access
  // prefer the setup token, because Wrangler's sign-in usually cannot see them.
  const missing = unknown(apis.wranglerMissing ?? 'Wrangler is not signed in.', 'unauthorized');
  const wrangler = { client: apis.wrangler, missing };
  const privileged = { client: apis.setup ?? apis.wrangler, missing };
  return {
    config,
    migrations,
    worker: await observeWorker(wrangler, account, manifest.cloudflare.worker),
    d1: await observeD1(wrangler, account, manifest, config.ok ? config.value : undefined),
    r2: manifest.r2?.length ? await observeR2(wrangler, account, manifest) : known([]),
    turnstile: manifest.turnstile?.length
      ? privileged.client
        ? await attempt(() => privileged.client.list(`${account}/challenges/widgets`))
        : missing
      : known([]),
    access: manifest.access?.length
      ? await observeAccess(privileged, account)
      : known({ enabled: true, providers: [], apps: [], policies: [] }),
    dns: await observeDns(resolve, manifest),
    confirmed,
    github: await observeGithub(run, directory, manifest),
  };
}
