import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

export const WORKER_DIR = path.join('apps', 'worker');
export const WRANGLER_TOML = path.join(WORKER_DIR, 'wrangler.toml');

/** What `wrangler d1 create` has not yet replaced. */
export const PLACEHOLDER_DB_ID = '00000000-0000-0000-0000-000000000000';

/** The two deployments declared in wrangler.toml. */
export type WranglerEnvironment = 'production' | 'preview';

export interface DatabasePlan {
  environment: WranglerEnvironment;
  label: string;
  /** Explains, to somebody about to say yes, what this database is for. */
  purpose: string;
}

/**
 * Both databases this repository deploys against, in the order bootstrap
 * provisions them.
 *
 * One list, because provisioning and verification disagreeing about which
 * databases exist is precisely the "verified but never provisioned" gap those
 * two phases exist to close.
 */
export const DATABASES: readonly DatabasePlan[] = [
  { environment: 'production', label: 'D1 database', purpose: 'the live site' },
  {
    environment: 'preview',
    label: 'Preview D1 database',
    purpose: 'pull request preview Workers, which all share it and keep nothing',
  },
];

interface D1Binding {
  binding?: string;
  database_name?: string;
  database_id?: string;
}

interface WranglerScope {
  d1_databases?: D1Binding[];
}

interface WranglerConfig extends WranglerScope {
  env?: Record<string, WranglerScope | undefined>;
}

/**
 * The D1 binding one environment declares.
 *
 * Parsed rather than pattern-matched. The readers below used to slice the file
 * at the `[env.preview]` heading and take the first `database_name` in each
 * half, which made block order load-bearing: a second environment, or a
 * top-level binding written below the preview one, silently answered for the
 * wrong database — and provisioning would then have written a real id over it.
 */
function d1Binding(toml: string, environment: WranglerEnvironment): D1Binding | undefined {
  const config = parse(toml) as WranglerConfig;
  const scope = environment === 'production' ? config : config.env?.[environment];
  return scope?.d1_databases?.[0];
}

export function readWranglerToml(): string {
  return readFileSync(WRANGLER_TOML, 'utf8');
}

/** The database name in wrangler.toml. Read rather than assumed, so renaming
 *  it there does not silently provision something else. */
export function databaseName(toml: string, environment: WranglerEnvironment): string | null {
  return d1Binding(toml, environment)?.database_name ?? null;
}

export function databaseId(toml: string, environment: WranglerEnvironment): string | null {
  const id = d1Binding(toml, environment)?.database_id;
  return !id || id === PLACEHOLDER_DB_ID ? null : id;
}

/** `wrangler d1 create` prints the new binding block; the id is in it. */
export function extractCreatedId(output: string): string | null {
  return /database_id\s*=\s*"?([0-9a-f-]{36})"?/i.exec(output)?.[1] ?? null;
}

/** The table a line belongs to, as the offsets of its `[header]` and its end. */
function tableAround(toml: string, offset: number): { start: number; end: number } {
  const start = toml.lastIndexOf('\n[', offset);
  const after = toml.slice(offset).search(/\n\[/u);
  return { start: start < 0 ? 0 : start, end: after < 0 ? toml.length : offset + after };
}

/**
 * Writes one environment's database id back, leaving every comment — and the
 * other environment's id — intact.
 *
 * Still a text edit, because a parse-and-serialize round trip would discard the
 * comments that explain why each block is there. It is anchored on the
 * database name, which differs between the two environments, so neither the
 * order of the blocks nor the identical placeholder id they both start with
 * can send the write to the wrong one.
 */
export function withDatabaseId(toml: string, environment: WranglerEnvironment, id: string): string {
  const name = databaseName(toml, environment);
  if (name === null) throw new Error(`No ${environment} d1_databases block to write an id into.`);

  // Anchored on the `database_name` assignment, not on the name anywhere in
  // the file: the Worker's own `name = "transitmapper"` is the first match for
  // the bare production name, and it is nowhere near the database block.
  const assignment = new RegExp(
    `database_name\\s*=\\s*"${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"`,
    'u',
  );
  const anchor = assignment.exec(toml)?.index;
  if (anchor === undefined) throw new Error(`No database_name = "${name}" to anchor the write to.`);

  const { start, end } = tableAround(toml, anchor);
  const table = toml
    .slice(start, end)
    .replace(/database_id\s*=\s*"[^"]*"/u, `database_id = "${id}"`);

  return `${toml.slice(0, start)}${table}${toml.slice(end)}`;
}

export function writeDatabaseId(toml: string, environment: WranglerEnvironment, id: string): void {
  writeFileSync(WRANGLER_TOML, withDatabaseId(toml, environment, id), 'utf8');
}
