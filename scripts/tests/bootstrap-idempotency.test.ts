import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArguments, runBootstrap, type BootstrapOptions } from '../bootstrap/cold-start.js';
import {
  databaseId,
  PLACEHOLDER_DB_ID,
  withDatabaseId,
  WRANGLER_TOML,
} from '../bootstrap/lib/wrangler-config.js';
import {
  ACCOUNT,
  FAKE_TOKEN,
  FakeServices,
  isMutation,
  MIGRATIONS,
  REPO_ROOT,
  type RunRecord,
} from './support/fake-bootstrap-services.test.js';

/**
 * The whole bootstrap, every phase in order, against fake services.
 *
 * The promise under test is idempotency: a run on a finished setup changes
 * nothing and reports ready, and a run after an interrupted one picks up
 * where that one stopped. So the fakes keep state the way the real services
 * do — databases, applied migrations, rulesets, environments, secrets — and
 * every assertion is about what a run did to that state or asked of the
 * person, never about the wording it printed.
 */

const OTHER_ACCOUNT = 'ffffffffffffffffffffffffffffffff';

const DEFAULTS: BootstrapOptions = { doctor: false, rotateToken: false, replaceAccountId: false };

async function run(
  services: FakeServices,
  options: Partial<BootstrapOptions> = {},
): Promise<RunRecord & { success: boolean }> {
  const io = services.io();
  const outcome = await runBootstrap({ ...DEFAULTS, ...options }, io);
  return { ...io.record, success: outcome.success };
}

const mutations = (record: RunRecord): string[] =>
  record.calls.map((call) => call.command).filter(isMutation);

const commandsMatching = (record: RunRecord, pattern: RegExp): string[] =>
  record.calls.map((call) => call.command).filter((command) => pattern.test(command));

let root: string;
let services: FakeServices;

function readToml(): string {
  return readFileSync(path.join(root, WRANGLER_TOML), 'utf8');
}

beforeEach(() => {
  // A brand-new setup: this repository's own configuration, with the
  // production id put back to the placeholder a fresh account starts from.
  root = mkdtempSync(path.join(tmpdir(), 'transitmapper-bootstrap-'));
  mkdirSync(path.join(root, path.dirname(WRANGLER_TOML)), { recursive: true });
  const toml = readFileSync(path.join(REPO_ROOT, WRANGLER_TOML), 'utf8');
  writeFileSync(
    path.join(root, WRANGLER_TOML),
    withDatabaseId(toml, 'production', PLACEHOLDER_DB_ID),
  );
  writeFileSync(
    path.join(root, 'package.json'),
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  services = new FakeServices(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('running the whole bootstrap twice', () => {
  it('finishes a brand-new setup on the first run', async () => {
    const first = await run(services);

    expect(first.success).toBe(true);
    expect(services.databases.map((database) => database.name).sort()).toEqual([
      'transitmapper',
      'transitmapper-preview',
    ]);
    for (const database of services.databases) expect(database.applied).toEqual(MIGRATIONS);
    for (const environment of ['production', 'preview'] as const) {
      const id = databaseId(readToml(), environment);
      expect(services.databases.some((database) => database.uuid === id)).toBe(true);
    }
    expect(services.rulesets.map((ruleset) => ruleset.name)).toEqual(['org-standard']);
    expect([...services.environments].sort()).toEqual(['preview', 'production']);
    for (const environment of ['production', 'preview']) {
      expect(services.secrets.get(environment)?.has('CLOUDFLARE_API_TOKEN')).toBe(true);
      expect(services.variables.get(environment)?.get('CLOUDFLARE_ACCOUNT_ID')).toBe(ACCOUNT.id);
    }
  });

  it('changes nothing, asks nothing, and reports ready on the second run', async () => {
    await run(services);
    const tomlAfterFirstRun = readToml();

    const second = await run(services);

    expect(second.success).toBe(true);
    expect(mutations(second)).toEqual([]);
    expect(second.prompts).toEqual([]);
    expect(second.writes).toEqual([]);
    expect(readToml()).toBe(tomlAfterFirstRun);
    expect(second.tables.flat().filter((row) => row.status !== 'ready')).toEqual([]);
  });

  it('never puts the token on a command line', async () => {
    const first = await run(services);

    expect(first.calls.some((call) => call.command.includes(FAKE_TOKEN))).toBe(false);
    expect(first.calls.some((call) => call.input === FAKE_TOKEN)).toBe(true);
  });
});

describe('resuming after a partial run', () => {
  it('retries migrations that failed on a database the first run created', async () => {
    services.faults.failingMigrationApplies = 1;
    const first = await run(services);
    expect(first.success).toBe(false);

    const second = await run(services);

    expect(second.success).toBe(true);
    expect(commandsMatching(second, /d1 create/u)).toEqual([]);
    expect(commandsMatching(second, /d1 migrations apply/u)).toHaveLength(1);
    for (const database of services.databases) expect(database.applied).toEqual(MIGRATIONS);

    const third = await run(services);
    expect(mutations(third)).toEqual([]);
  });

  it('adopts a database an interrupted run created but never wrote back', async () => {
    services.databases.push({
      uuid: 'bbbbbbbb-0000-4000-8000-000000000001',
      name: 'transitmapper-preview',
      applied: [],
    });

    const first = await run(services);

    expect(first.success).toBe(true);
    expect(commandsMatching(first, /d1 create transitmapper-preview/u)).toEqual([]);
    expect(databaseId(readToml(), 'preview')).toBe('bbbbbbbb-0000-4000-8000-000000000001');
    expect(
      services.databases.filter((database) => database.name === 'transitmapper-preview'),
    ).toHaveLength(1);
  });

  it('finds a created database by name when wrangler does not print its id', async () => {
    services.faults.createHidesId = true;

    const first = await run(services);

    expect(first.success).toBe(true);
    expect(commandsMatching(first, /d1 create/u)).toHaveLength(2);
    expect(databaseId(readToml(), 'production')).not.toBeNull();
    expect(databaseId(readToml(), 'preview')).not.toBeNull();
    expect(mutations(await run(services))).toEqual([]);
  });
});

describe('repository governance', () => {
  it('writes no ruleset when the rulesets cannot be read', async () => {
    await run(services);
    services.faults.rulesetListFails = true;

    const next = await run(services);

    expect(next.success).toBe(false);
    expect(commandsMatching(next, /--method (?:POST|PUT) repos\/:owner\/:repo\/rulesets/u)).toEqual(
      [],
    );
    expect(services.rulesets).toHaveLength(1);
  });

  it('finds the standard ruleset on a later page instead of creating another', async () => {
    await run(services);
    const others = Array.from({ length: 100 }, (_, index) => ({
      id: 1000 + index,
      name: `other-${index}`,
      body: {},
    }));
    services.rulesets.unshift(...others);

    const next = await run(services);

    expect(next.success).toBe(true);
    expect(mutations(next)).toEqual([]);
  });
});

describe('credentials that are already set', () => {
  it('leaves an account variable naming another account alone without the flag', async () => {
    await run(services);
    services.variables.get('production')?.set('CLOUDFLARE_ACCOUNT_ID', OTHER_ACCOUNT);

    const next = await run(services);

    expect(next.success).toBe(false);
    expect(commandsMatching(next, /gh variable set/u)).toEqual([]);
    expect(services.variables.get('production')?.get('CLOUDFLARE_ACCOUNT_ID')).toBe(OTHER_ACCOUNT);
  });

  it('overwrites that variable only when --replace-account-id asks', async () => {
    await run(services);
    services.variables.get('production')?.set('CLOUDFLARE_ACCOUNT_ID', OTHER_ACCOUNT);

    const next = await run(services, { replaceAccountId: true });

    expect(next.success).toBe(true);
    expect(commandsMatching(next, /gh variable set CLOUDFLARE_ACCOUNT_ID/u)).toEqual([
      'gh variable set CLOUDFLARE_ACCOUNT_ID --env production',
    ]);
    expect(services.variables.get('production')?.get('CLOUDFLARE_ACCOUNT_ID')).toBe(ACCOUNT.id);
  });

  it('asks for the token again only when --rotate-token asks', async () => {
    await run(services);

    const next = await run(services, { rotateToken: true });

    expect(next.success).toBe(true);
    expect(commandsMatching(next, /gh secret set CLOUDFLARE_API_TOKEN/u)).toHaveLength(2);
    expect(mutations(next).every((command) => command.startsWith('gh secret set'))).toBe(true);
  });
});

describe('preflight', () => {
  it('reports a brand-new setup without changing or asking anything', async () => {
    const report = await run(services, { doctor: true });

    expect(report.success).toBe(false);
    expect(mutations(report)).toEqual([]);
    expect(report.prompts).toEqual([]);
    expect(report.writes).toEqual([]);
  });
});

describe('command-line flags', () => {
  it('refuses a flag it does not know rather than ignoring it', () => {
    expect(parseArguments(['--rotate-tokn'])).toEqual({ unknown: '--rotate-tokn' });
    expect(parseArguments(['--rotate-token'])).toMatchObject({ rotateToken: true });
  });
});
