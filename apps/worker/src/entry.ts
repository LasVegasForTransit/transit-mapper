// Wrangler needs the Durable Object class at the module boundary, while the
// request router is also imported by a Node-based deterministic verifier.
// Keeping this deployment-only export here prevents that verifier from
// evaluating the workerd-only `cloudflare:workers` module.
export { PlaceSearchGate } from './place-search-gate';
export { default } from './index';
