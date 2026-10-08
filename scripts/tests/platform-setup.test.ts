import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';

interface Platform {
  cloudflare: { worker: string; accountIdEnv: string; cloudflareConfig: string; domains: string[] };
  d1: { binding: string; name: string; environment?: string; migrations: string }[];
  r2: { binding: string; name: string }[];
  github: { variables: { name: string; environment?: string }[] };
  secrets: { name: string; targets: string[] }[];
}
interface Config {
  name: string;
  d1_databases: { binding: string; database_name: string; migrations_dir: string }[];
  env: { preview: { d1_databases: Config['d1_databases'] } };
  r2_buckets: { binding: string; bucket_name: string }[];
}
const root = resolve(import.meta.dirname, '../..');
const platform = JSON.parse(
  readFileSync(resolve(root, 'apps/worker/platform.json'), 'utf8'),
) as Platform;
const config = parse(
  readFileSync(resolve(root, 'apps/worker/wrangler.toml'), 'utf8'),
) as unknown as Config;

describe('shared production setup requirements', () => {
  it('preserves the production and preview databases without mixing their DB bindings', () => {
    expect(platform.cloudflare.worker).toBe(config.name);
    expect(platform.cloudflare.accountIdEnv).toBe('CLOUDFLARE_ACCOUNT_ID');
    expect(platform.cloudflare.cloudflareConfig).toBe('cloudflare.config.ts');
    for (const [environment, scope] of [
      [undefined, config],
      ['preview', config.env.preview],
    ] as const) {
      const declared = platform.d1.filter((database) => database.environment === environment);
      expect(
        declared.map((database) => ({
          binding: database.binding,
          database_name: database.name,
          migrations_dir: database.migrations,
        })),
      ).toEqual(
        scope.d1_databases.map(({ binding, database_name, migrations_dir }) => ({
          binding,
          database_name,
          migrations_dir,
        })),
      );
    }
    expect(platform.d1[0]?.name).not.toBe(platform.d1[1]?.name);
  });
  it('retains the archive bucket and every CI deploy/account/analytics requirement', () => {
    expect(
      platform.r2.map((bucket) => ({ binding: bucket.binding, bucket_name: bucket.name })),
    ).toEqual(config.r2_buckets);
    expect(
      platform.secrets.find((secret) => secret.name === 'CLOUDFLARE_API_TOKEN')?.targets,
    ).toEqual(['github:production', 'github:preview']);
    const scoped = platform.github.variables.map(
      (variable) => `${variable.environment}:${variable.name}`,
    );
    expect(scoped).toEqual(
      expect.arrayContaining([
        'production:CLOUDFLARE_ACCOUNT_ID',
        'preview:CLOUDFLARE_ACCOUNT_ID',
        'production:PUBLIC_LVBT_CWA_TOKEN',
        'production:PUBLIC_LVBT_LABS_CWA_TOKEN',
      ]),
    );
    expect(platform.cloudflare.domains).toContain('map.lasvegasfortransit.org');
  });
});
