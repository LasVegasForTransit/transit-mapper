import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BootstrapIo } from '../../bootstrap/lib/io.js';
import type { CommandResult, RunOptions } from '../../bootstrap/lib/shell.js';
import type { ToolRow } from '../../bootstrap/lib/ui.js';
import {
  databaseId,
  WRANGLER,
  WRANGLER_TOML,
  type WranglerEnvironment,
} from '../../bootstrap/lib/wrangler-config.js';

/**
 * Fake versions of everything the bootstrap talks to — wrangler, gh, the
 * GitHub REST API, pnpm, the terminal — keeping state the way the real
 * services do, so a test can run the bootstrap several times and look at
 * what each run changed.
 *
 * Every command the bootstrap is not expected to run throws, so a new call
 * shows up as a failing test rather than as a silently successful fake.
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** The migration files this checkout ships, in the order wrangler applies them. */
export const MIGRATIONS = readdirSync(path.join(REPO_ROOT, 'apps/worker/src/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** The account wrangler.toml declares, as `wrangler whoami --json` shows it. */
export const ACCOUNT = {
  id: '2557b5c2e166292ded0f8425b73075e9',
  name: 'Las Vegas for Better Transit',
};
export const FAKE_TOKEN = 'fake-cloudflare-token-for-tests';
/** Shaped like a Web Analytics token, 32 letters and digits, and plainly
 *  not a real one — to a reader and to the secret scanner. */
export const FAKE_ANALYTICS_TOKEN = 'a1'.repeat(16);

interface FakeDatabase {
  uuid: string;
  name: string;
  applied: string[];
}

interface FakeRuleset {
  id: number;
  name: string;
  body: Record<string, unknown>;
}

/** Faults a test switches on to reproduce an interrupted or failed run. */
interface Faults {
  /** How many `migrations apply` calls apply one migration and then fail. */
  failingMigrationApplies: number;
  /** `d1 create` succeeds without printing the new id. */
  createHidesId: boolean;
  /** Listing rulesets fails. */
  rulesetListFails: boolean;
}

interface RecordedCall {
  command: string;
  input?: string;
  env?: Readonly<Record<string, string>>;
}

/** Everything one run did that a person or a service would notice. */
export interface RunRecord {
  calls: RecordedCall[];
  prompts: string[];
  writes: string[];
  tables: ToolRow[][];
}

/** One GitHub API request as the fake routes it. */
interface ApiRequest {
  match: RegExpExecArray;
  jq: string | undefined;
  page: number;
  body: Record<string, unknown>;
}

type ApiRoute = [RegExp, (request: ApiRequest) => CommandResult];

const ok = (stdout = ''): CommandResult => ({ ok: true, stdout, stderr: '' });
const fail = (stderr: string): CommandResult => ({ ok: false, stdout: '', stderr });
const json = (value: unknown): CommandResult => ok(JSON.stringify(value));

/** Commands that change a service, a machine, or an account. */
export function isMutation(command: string): boolean {
  return /d1 create|d1 migrations apply|--method (?:POST|PUT|PATCH|DELETE)|gh secret set|gh variable set|pnpm install/u.test(
    command,
  );
}

export class FakeServices {
  databases: FakeDatabase[] = [];
  installed = false;
  environments = new Set<string>();
  secrets = new Map<string, Set<string>>();
  variables = new Map<string, Map<string, string>>();
  rulesets: FakeRuleset[] = [];
  security: Record<string, string> = {
    secret_scanning: 'disabled',
    secret_scanning_push_protection: 'disabled',
  };
  vulnerabilityAlerts = false;
  dependabot = false;
  actionsPolicy: Record<string, unknown> = {
    enabled: true,
    allowed_actions: 'all',
    sha_pinning_required: false,
  };
  actionsWorkflow: Record<string, unknown> = {
    default_workflow_permissions: 'write',
    can_approve_pull_request_reviews: false,
  };
  faults: Faults = { failingMigrationApplies: 0, createHidesId: false, rulesetListFails: false };
  private created = 0;
  private nextRulesetId = 1;

  constructor(private readonly root: string) {}

  /** A fresh seam for one run, recording what that run does. */
  io(): BootstrapIo & { record: RunRecord } {
    const record: RunRecord = { calls: [], prompts: [], writes: [], tables: [] };
    const ask = <T>(message: string, answer: T): Promise<T> => {
      record.prompts.push(message);
      return Promise.resolve(answer);
    };
    return {
      record,
      run: (command, options = {}) => {
        record.calls.push({ command, ...options });
        return this.handle(command, options);
      },
      runInteractive: (command) => {
        throw new Error(`unexpected interactive command: ${command}`);
      },
      readFile: (relativePath) => readFileSync(path.join(this.root, relativePath), 'utf8'),
      writeFile: (relativePath, content) => {
        record.writes.push(relativePath);
        writeFileSync(path.join(this.root, relativePath), content, 'utf8');
      },
      confirm: (message) => ask(message, true),
      secret: (message) => ask(message, FAKE_TOKEN),
      text: (message, check) => {
        const refused = check(FAKE_ANALYTICS_TOKEN);
        if (refused) throw new Error(`the fake analytics token was refused: ${refused}`);
        return ask(message, FAKE_ANALYTICS_TOKEN);
      },
      openUrl: () => true,
      note: () => undefined,
      table: (_title, rows) => {
        record.tables.push([...rows]);
      },
      log: () => undefined,
    };
  }

  private handle(command: string, options: RunOptions): CommandResult {
    if (command.startsWith(`${WRANGLER} `)) {
      return this.wrangler(command.slice(WRANGLER.length + 1), options);
    }
    if (command.startsWith('gh api ')) return this.githubApi(command, options.input);
    if (command.startsWith('gh ')) return this.githubCli(command, options.input);
    return this.pnpm(command);
  }

  private pnpm(command: string): CommandResult {
    if (command === 'pnpm --version') return ok('11.25.0');
    if (command === 'pnpm run check:env') return this.installed ? ok() : fail('stale');
    if (command === 'pnpm check') return ok();
    if (command !== 'pnpm install --frozen-lockfile') {
      throw new Error(`unexpected command: ${command}`);
    }
    this.installed = true;
    return ok();
  }

  private wrangler(args: string, options: RunOptions): CommandResult {
    if (args === 'whoami --json') return json({ loggedIn: true, accounts: [ACCOUNT] });
    // Real wrangler cannot pick an account non-interactively for a login
    // that can see several, so every D1 call has to name the account.
    if (options.env?.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT.id) {
      return fail('More than one account available but unable to select one');
    }
    if (args === 'd1 list --json') {
      return json(this.databases.map(({ uuid, name }) => ({ uuid, name })));
    }
    const create = /^d1 create (\S+)$/u.exec(args);
    if (create?.[1]) return this.createDatabase(create[1]);
    const migrations = /^d1 migrations (list|apply) DB --remote(?: --env (\w+))?$/u.exec(args);
    if (!migrations?.[1]) throw new Error(`unexpected wrangler command: ${args}`);
    const environment = (migrations[2] ?? 'production') as WranglerEnvironment;
    return migrations[1] === 'list' ? this.listMigrations(environment) : this.apply(environment);
  }

  private createDatabase(name: string): CommandResult {
    if (this.databases.some((database) => database.name === name)) {
      return fail('A database with that name already exists [code: 7502]');
    }
    this.created += 1;
    const uuid = `aaaaaaaa-0000-4000-8000-${String(this.created).padStart(12, '0')}`;
    this.databases.push({ uuid, name, applied: [] });
    const binding = ['[[d1_databases]]', `database_name = "${name}"`, `database_id = "${uuid}"`];
    return ok(
      [
        `✅ Successfully created DB '${name}' in region WNAM`,
        ...(this.faults.createHidesId ? [] : binding),
      ].join('\n'),
    );
  }

  /** The database `DB` resolves to, through the copy of wrangler.toml. */
  private boundDatabase(environment: WranglerEnvironment): FakeDatabase | undefined {
    const id = databaseId(readFileSync(path.join(this.root, WRANGLER_TOML), 'utf8'), environment);
    return this.databases.find((database) => database.uuid === id);
  }

  private listMigrations(environment: WranglerEnvironment): CommandResult {
    const database = this.boundDatabase(environment);
    if (!database) return fail("Couldn't find a D1 DB with that id");
    const pending = MIGRATIONS.filter((migration) => !database.applied.includes(migration));
    if (pending.length === 0) return ok('✅ No migrations to apply!');
    const table = ['┌──────┐', '│ Name │', ...pending.map((migration) => `│ ${migration} │`)];
    return ok(['Migrations to be applied:', ...table].join('\n'));
  }

  private apply(environment: WranglerEnvironment): CommandResult {
    const database = this.boundDatabase(environment);
    if (!database) return fail("Couldn't find a D1 DB with that id");
    const pending = MIGRATIONS.filter((migration) => !database.applied.includes(migration));
    if (this.faults.failingMigrationApplies === 0) {
      database.applied.push(...pending);
      return ok();
    }
    this.faults.failingMigrationApplies -= 1;
    database.applied.push(...pending.slice(0, 1));
    return fail('Migration failed');
  }

  private githubCli(command: string, input: string | undefined): CommandResult {
    if (command === 'gh auth status') return ok();
    if (command.startsWith('gh repo view --json viewerCanAdminister')) return ok('true');
    const list = /^gh (secret|variable) list --env (\w+) --json/u.exec(command);
    if (list?.[1] && list[2]) return this.listCredentials(list[1], list[2]);
    const set = /^gh (secret|variable) set (\w+) --env (\w+)$/u.exec(command);
    if (!set?.[1] || !set[2] || !set[3]) throw new Error(`unexpected gh command: ${command}`);
    return this.setCredential(set[1], set[2], set[3], input);
  }

  private listCredentials(kind: string, environment: string): CommandResult {
    if (!this.environments.has(environment)) return fail('HTTP 404: Not Found');
    if (kind === 'secret') {
      return json([...(this.secrets.get(environment) ?? [])].map((name) => ({ name })));
    }
    const values = this.variables.get(environment) ?? new Map<string, string>();
    return json([...values].map(([name, value]) => ({ name, value })));
  }

  private setCredential(
    kind: string,
    name: string,
    environment: string,
    input: string | undefined,
  ): CommandResult {
    if (!this.environments.has(environment)) return fail('HTTP 404: Not Found');
    if (!input) return fail('no value on standard input');
    if (kind === 'secret') {
      this.secrets.set(environment, (this.secrets.get(environment) ?? new Set()).add(name));
    } else {
      const values = this.variables.get(environment) ?? new Map<string, string>();
      this.variables.set(environment, values.set(name, input));
    }
    return ok();
  }

  private githubApi(command: string, input: string | undefined): CommandResult {
    const method = /--method (\w+)/u.exec(command)?.[1] ?? 'GET';
    const route = /"?repos\/:owner\/:repo([^"\s]*)"?/u.exec(command)?.[1] ?? '';
    const [pathname = '', query = ''] = route.split('?');
    const key = `${method} ${pathname || '/'}`;
    const request = {
      jq: /--jq (\S+)/u.exec(command)?.[1],
      page: Number(new URLSearchParams(query).get('page') ?? '1'),
      body: input === undefined ? {} : (JSON.parse(input) as Record<string, unknown>),
    };
    for (const [pattern, handler] of this.apiRoutes()) {
      const match = pattern.exec(key);
      if (match) return handler({ ...request, match });
    }
    throw new Error(`unexpected GitHub API call: ${key}`);
  }

  private apiRoutes(): ApiRoute[] {
    return [
      [/^GET \/$/u, ({ jq }) => (jq === '.owner.type' ? ok('Organization') : this.securityState())],
      [/^PATCH \/$/u, ({ body }) => this.patchSecurity(body)],
      [/^GET \/environments$/u, ({ page }) => this.listEnvironments(page)],
      [/^PUT \/environments\/(\w+)$/u, ({ match }) => this.addEnvironment(match[1] ?? '')],
      [/^GET \/rulesets$/u, ({ page }) => this.listRulesets(page)],
      [/^POST \/rulesets$/u, ({ body }) => this.createRuleset(body)],
      [/^(GET|PUT) \/rulesets\/(\d+)$/u, (request) => this.ruleset(request)],
      [/^GET \/vulnerability-alerts$/u, () => (this.vulnerabilityAlerts ? ok() : fail('HTTP 404'))],
      [/^PUT \/vulnerability-alerts$/u, () => this.enable(() => (this.vulnerabilityAlerts = true))],
      [/^GET \/automated-security-fixes$/u, () => json({ enabled: this.dependabot })],
      [/^PUT \/automated-security-fixes$/u, () => this.enable(() => (this.dependabot = true))],
      [/^GET \/actions\/permissions$/u, () => json(this.actionsPolicy)],
      [/^PUT \/actions\/permissions$/u, ({ body }) => this.merge(this.actionsPolicy, body)],
      [/^GET \/actions\/permissions\/workflow$/u, () => json(this.actionsWorkflow)],
      [
        /^PUT \/actions\/permissions\/workflow$/u,
        ({ body }) => this.merge(this.actionsWorkflow, body),
      ],
    ];
  }

  private securityState(): CommandResult {
    return json(
      Object.fromEntries(Object.entries(this.security).map(([key, status]) => [key, { status }])),
    );
  }

  private patchSecurity(body: Record<string, unknown>): CommandResult {
    const requested = (body.security_and_analysis ?? {}) as Record<string, { status: string }>;
    for (const [setting, value] of Object.entries(requested)) this.security[setting] = value.status;
    return ok();
  }

  private listEnvironments(page: number): CommandResult {
    const names = page === 1 ? [...this.environments] : [];
    return json({ total_count: names.length, environments: names.map((name) => ({ name })) });
  }

  private addEnvironment(name: string): CommandResult {
    this.environments.add(name);
    return json({ name });
  }

  private listRulesets(page: number): CommandResult {
    if (this.faults.rulesetListFails) return fail('HTTP 502: Bad Gateway');
    const slice = this.rulesets.slice((page - 1) * 100, page * 100);
    return json(slice.map(({ id, name }) => ({ id, name })));
  }

  private createRuleset(body: Record<string, unknown>): CommandResult {
    const id = this.nextRulesetId++;
    this.rulesets.push({ id, name: String(body.name), body });
    return json({ id });
  }

  private ruleset({ match, body }: ApiRequest): CommandResult {
    const existing = this.rulesets.find((candidate) => candidate.id === Number(match[2]));
    if (!existing) return fail('HTTP 404: Not Found');
    if (match[1] === 'PUT') existing.body = body;
    return json({ ...existing.body, id: existing.id });
  }

  private enable(change: () => void): CommandResult {
    change();
    return ok();
  }

  private merge(target: Record<string, unknown>, body: Record<string, unknown>): CommandResult {
    Object.assign(target, body);
    return ok();
  }
}
