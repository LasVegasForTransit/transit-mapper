import { DurableObject } from 'cloudflare:workers';

const NOMINATIM_INTERVAL_MS = 1000;
const NEXT_ALLOWED_AT_KEY = 'next-allowed-at';

/**
 * The public Nominatim application budget is global, so every cache miss uses
 * one deterministic object. Durable Object storage gates serialize the
 * read-then-write reservation and persist it across object eviction.
 */
export class PlaceSearchGate extends DurableObject {
  async reserve(now = Date.now()): Promise<number> {
    const nextAllowedAt = (await this.ctx.storage.get<number>(NEXT_ALLOWED_AT_KEY)) ?? 0;
    if (now < nextAllowedAt) return Math.max(1, Math.ceil((nextAllowedAt - now) / 1000));
    await this.ctx.storage.put(NEXT_ALLOWED_AT_KEY, now + NOMINATIM_INTERVAL_MS);
    return 0;
  }
}
