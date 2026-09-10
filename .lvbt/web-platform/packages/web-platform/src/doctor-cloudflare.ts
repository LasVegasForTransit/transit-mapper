import { z } from 'zod';
import { doctorCheck } from './doctor-check.js';

export interface CloudflareTarget {
  accountId: string;
  zoneId: string;
  zoneName: string;
  hostname: string;
  workers: { slug: string; name: string }[];
}

export interface CloudflareRead {
  get(endpoint: string): Promise<unknown>;
  list(endpoint: string): Promise<unknown>;
}

function validZone(input: unknown, target: CloudflareTarget) {
  const zone = z
    .object({
      id: z.string(),
      name: z.string(),
      account: z.object({ id: z.string() }),
      status: z.string(),
      paused: z.boolean(),
    })
    .parse(input);
  return (
    zone.id === target.zoneId &&
    zone.name === target.zoneName &&
    zone.account.id === target.accountId &&
    zone.status === 'active' &&
    !zone.paused
  );
}

function validDomain(input: unknown, target: CloudflareTarget) {
  const domains = z
    .array(z.object({ hostname: z.string(), service: z.string(), zone_id: z.string() }))
    .parse(input)
    .filter((domain) => domain.hostname === target.hostname);
  return (
    domains.length === 1 &&
    domains[0]?.service === target.workers.find((worker) => worker.slug === 'home')?.name &&
    domains[0]?.zone_id === target.zoneId
  );
}

function validRoutes(input: unknown, target: CloudflareTarget) {
  const routes = z
    .array(z.object({ pattern: z.string(), script: z.string().nullable().optional() }))
    .parse(input);
  const expected = target.workers.flatMap((worker) =>
    (worker.slug === 'home'
      ? [`${target.hostname}/*`]
      : [`${target.hostname}/${worker.slug}`, `${target.hostname}/${worker.slug}/*`]
    ).map((pattern) => ({ pattern, script: worker.name })),
  );
  const owned = routes.filter((route) => route.pattern.includes(target.hostname));
  return (
    expected.every(
      (route) =>
        owned.filter(
          (candidate) => candidate.pattern === route.pattern && candidate.script === route.script,
        ).length === 1,
    ) &&
    owned.every((route) =>
      expected.some(
        (candidate) => candidate.pattern === route.pattern && candidate.script === route.script,
      ),
    )
  );
}

function validDns(input: unknown, hostname: string) {
  return z
    .array(z.object({ name: z.string(), type: z.string(), proxied: z.boolean().optional() }))
    .parse(input)
    .some(
      (record) =>
        record.name === hostname &&
        ['A', 'AAAA', 'CNAME'].includes(record.type) &&
        record.proxied === true,
    );
}

function validAnalytics(input: unknown, hostname: string) {
  const sites = z
    .array(
      z.object({
        site_token: z.string().optional(),
        rules: z
          .array(
            z.object({
              host: z.string().optional(),
              inclusive: z.boolean().optional(),
              is_paused: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
    )
    .parse(input);
  return (
    sites.filter(
      (site) =>
        site.site_token &&
        site.rules?.some(
          (rule) => rule.host === hostname && rule.inclusive === true && rule.is_paused !== true,
        ),
    ).length === 1
  );
}

export async function cloudflareDoctor(target: CloudflareTarget, read: CloudflareRead) {
  const account = `accounts/${target.accountId}`;
  const zone = `zones/${target.zoneId}`;
  const check = (id: string, requirement: string, inspect: () => Promise<boolean>) =>
    doctorCheck(`cloudflare.${id}`, requirement, inspect);
  return [
    await check('zone', 'The declared zone is active in the declared account.', async () =>
      validZone(await read.get(zone), target),
    ),
    await check(
      'domain',
      'The Labs custom domain belongs to the home Worker in the declared zone.',
      async () =>
        validDomain(
          await read.list(`${account}/workers/domains?hostname=${target.hostname}`),
          target,
        ),
    ),
    await check(
      'routes',
      'Home owns the catchall; every published lab owns its exact and subtree routes without conflicting patterns.',
      async () => validRoutes(await read.list(`${zone}/workers/routes`), target),
    ),
    await check('dns', 'The hostname has a proxied address or CNAME record.', async () =>
      validDns(await read.list(`${zone}/dns_records?name=${target.hostname}`), target.hostname),
    ),
    await check('workers', 'Every published lab has its declared Worker.', async () => {
      const workers = z
        .array(z.object({ id: z.string() }))
        .parse(await read.list(`${account}/workers/scripts`));
      return target.workers.every((worker) =>
        workers.some((existing) => existing.id === worker.name),
      );
    }),
    await check('analytics', 'One Web Analytics site includes the Labs hostname.', async () =>
      validAnalytics(await read.list(`${account}/rum/site_info/list`), target.hostname),
    ),
  ];
}
