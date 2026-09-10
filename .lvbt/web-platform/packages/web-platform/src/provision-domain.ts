import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const targetSchema = z.object({
  accountId: z.string().min(1),
  zoneId: z.string().min(1),
  zoneName: z.string().min(1),
  hostname: z.string().min(1),
  service: z.string().min(1),
});
const domainSchema = z.object({
  hostname: z.string(),
  service: z.string(),
  zone_id: z.string(),
  zone_name: z.string().optional(),
});
type DomainWrite = (body: {
  zone_id: string;
  zone_name: string;
  hostname: string;
  service: string;
}) => Promise<void>;

export function provisionCustomDomain(
  input: z.input<typeof targetSchema>,
  read: () => Promise<unknown>,
  attach: DomainWrite,
): ProvisionResource {
  const target = targetSchema.parse(input);
  const desired = {
    zone_id: target.zoneId,
    zone_name: target.zoneName,
    hostname: target.hostname,
    service: target.service,
  };
  return {
    id: `cloudflare.domain.${target.hostname}`,
    read: async () => {
      const matches = z
        .array(domainSchema)
        .parse(await read())
        .filter((domain) => domain.hostname === target.hostname);
      if (matches.length > 1) throw new Error('Duplicate Worker custom domains require review.');
      const existing = matches[0];
      if (existing === undefined) return false;
      if (existing.zone_id !== target.zoneId || existing.service !== target.service)
        throw new Error('The custom domain belongs to another Worker or zone.');
      return true;
    },
    desired: () => true,
    write: () => attach(desired),
  };
}
