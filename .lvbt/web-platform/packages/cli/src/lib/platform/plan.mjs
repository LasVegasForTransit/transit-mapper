import { planAccess } from './plan-access.mjs';
import { planD1, planR2, planTurnstile, planWorker } from './plan-cloudflare.mjs';
import {
  planEmail,
  planForbidden,
  planGithubEnvironments,
  planSecrets,
  planVars,
} from './plan-values.mjs';

/**
 * Compare what a manifest declares with what exists, and say for every item
 * whether it is ready, why not, and what fixes it. Pure: the same manifest
 * and state always give the same plan, so it is tested without a network.
 */

export { SETUP } from './plan-items.mjs';
export { findWidget } from './plan-cloudflare.mjs';
export { accessDifferences, allowRule, findApp } from './plan-access.mjs';
export { isSensitive, secretSource } from './plan-values.mjs';

/**
 * Every item the manifest declares, in the order setup works through them:
 * each one comes after the things it depends on.
 */
export function planPlatform({ manifest, state, configPath }) {
  const context = { manifest, state, configPath };
  return [
    ...planWorker(context),
    ...planD1(context),
    ...planR2(context),
    ...planTurnstile(context),
    ...planAccess(context),
    ...planGithubEnvironments(context),
    ...planSecrets(context),
    ...planVars(context),
    ...planEmail(context),
    ...planForbidden(context),
  ];
}

/** Ready when every required item is ok. Anything else is listed by urgency. */
export function readiness(items) {
  const open = items.filter((entry) => entry.status !== 'ok');
  const now = open.filter((entry) => entry.level === 'required');
  return {
    ready: now.length === 0,
    ok: items.length - open.length,
    now,
    later: open.filter((entry) => entry.level === 'later'),
    recommended: open.filter((entry) => entry.level === 'recommended'),
  };
}
