/**
 * The shape every plan item shares. An item's `level` decides whether it
 * blocks production: `required` items fail the check, while `later` (a
 * feature not built yet) and `recommended` items only warn. `action` is what
 * `lvbt bootstrap --production` does about it; a `manual` action carries
 * dashboard steps instead.
 */

export const SETUP = 'pnpm bootstrap --production';
export const TOKEN_HINT = `needs a Cloudflare API token: run ${SETUP}, or set LVBT_CLOUDFLARE_SETUP_TOKEN`;
export const GH_HINT = 'sign in: gh auth login';

export function item(fields) {
  return { level: 'required', ...fields };
}

/** An item whose current state could not be read, with what would let it be read. */
export function unknownItem(fields, observation) {
  const { credentialHint, ...rest } = fields;
  return item({
    ...rest,
    status: 'unknown',
    detail: `could not check: ${observation.reason}`,
    next:
      observation.kind === 'unauthorized'
        ? (credentialHint ?? 'sign in: pnpm exec wrangler login')
        : 'run the check again; if it keeps failing, read the reason above',
  });
}

export function targetLabel(manifest, target) {
  return target === 'worker' ? `Worker ${manifest.cloudflare.worker}` : `GitHub ${target.slice(7)}`;
}

/**
 * The steps to show when a person must create something by hand and the
 * value it produces is asked for later, so nothing is copied before it can
 * be pasted.
 */
export function manualGuide(guide) {
  return { url: guide.url, steps: guide.manualSteps ?? guide.steps };
}
