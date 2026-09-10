import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const targetSchema = z.object({
  accountId: z.string().min(1),
  zoneId: z.string().min(1),
  hostname: z.string().min(1),
  repository: z.string().min(1),
  environment: z.string().min(1),
});
const siteSchema = z.object({
  site_tag: z.string().min(1),
  site_token: z.string().min(1),
  rules: z
    .array(
      z.object({
        host: z.string().optional(),
        inclusive: z.boolean().optional(),
        is_paused: z.boolean().optional(),
      }),
    )
    .optional(),
});
const variablesSchema = z.object({
  variables: z.array(z.object({ name: z.string(), value: z.string() })),
});
interface Variable {
  name: string;
  value: string;
}
type VariableWrite = (method: 'POST' | 'PATCH', endpoint: string, body: Variable) => Promise<void>;
interface AnalyticsProviders {
  readSites(): Promise<unknown>;
  createSite(body: { auto_install: false; host: string; zone_tag: string }): Promise<void>;
  readVariables(): Promise<unknown>;
  writeVariable: VariableWrite;
}

function analyticsToken(input: unknown, hostname: string) {
  const referenced = z
    .array(siteSchema)
    .parse(input)
    .filter((site) => site.rules?.some((rule) => rule.host === hostname));
  if (referenced.length > 1) throw new Error('Duplicate Web Analytics sites require review.');
  const site = referenced[0];
  if (site === undefined) return null;
  if (
    !site.rules?.some(
      (rule) => rule.host === hostname && rule.inclusive === true && rule.is_paused !== true,
    )
  )
    throw new Error('The existing Web Analytics site does not actively include the hostname.');
  return site.site_token;
}

export function provisionAnalytics(
  input: z.input<typeof targetSchema>,
  providers: AnalyticsProviders,
): ProvisionResource[] {
  const target = targetSchema.parse(input);
  const variableName = 'CLOUDFLARE_WEB_ANALYTICS_TOKEN';
  const endpoint = `repos/${target.repository}/environments/${encodeURIComponent(target.environment)}/variables`;
  const loadToken = async () => analyticsToken(await providers.readSites(), target.hostname);
  return [
    {
      id: `cloudflare.analytics.${target.hostname}`,
      read: async () => (await loadToken()) !== null,
      desired: () => true,
      write: () =>
        providers.createSite({
          auto_install: false,
          host: target.hostname,
          zone_tag: target.zoneId,
        }),
    },
    {
      id: `github.environment-variable.${variableName}`,
      read: async () => {
        const token = await loadToken();
        if (token === null) return false;
        const matches = variablesSchema
          .parse(await providers.readVariables())
          .variables.filter((variable) => variable.name === variableName);
        if (matches.length > 1) throw new Error('Duplicate environment variables require review.');
        return matches[0]?.value === token;
      },
      desired: () => true,
      write: async () => {
        const token = await loadToken();
        if (token === null) throw new Error('Web Analytics site token is unavailable.');
        const matches = variablesSchema
          .parse(await providers.readVariables())
          .variables.filter((variable) => variable.name === variableName);
        if (matches.length > 1) throw new Error('Duplicate environment variables require review.');
        await providers.writeVariable(
          matches.length === 0 ? 'POST' : 'PATCH',
          matches.length === 0 ? endpoint : `${endpoint}/${variableName}`,
          { name: variableName, value: token },
        );
      },
    },
  ];
}
