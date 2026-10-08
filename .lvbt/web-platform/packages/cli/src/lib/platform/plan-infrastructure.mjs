import { item, SETUP, TOKEN_HINT, unknownItem, GH_HINT } from './plan-items.mjs';

/** Declared public domains: check ownership before suggesting any attachment. */
export function planDomains({ manifest, state }) {
  return (manifest.cloudflare.domains ?? []).map((hostname) => {
    const fields = { id: `domain:${hostname}`, section: 'Public domains', label: hostname };
    const domains = state.domains;
    if (!domains?.ok)
      return unknownItem(
        { ...fields, credentialHint: TOKEN_HINT },
        domains ?? { reason: 'not read' },
      );
    const matches = domains.value.filter((domain) => domain.hostname === hostname);
    if (matches.length > 1)
      return item({
        ...fields,
        status: 'mismatch',
        detail: 'has duplicate Worker custom-domain records',
        next: 'review the provider records before changing any domain',
      });
    const existing = matches[0];
    if (existing) {
      if (
        existing.service !== manifest.cloudflare.worker ||
        existing.zone_id !== manifest.cloudflare.zone.id
      )
        return item({
          ...fields,
          status: 'mismatch',
          detail: `belongs to another Worker or zone (${existing.service})`,
          next: 'review the existing owner; do not take over a public hostname during setup',
        });
      return item({ ...fields, status: 'ok', detail: `routes to ${manifest.cloudflare.worker}` });
    }
    return item({
      ...fields,
      status: 'missing',
      detail: 'is not attached as a Worker custom domain',
      next: `${SETUP} shows the attachment steps`,
      action: {
        type: 'manual',
        key: fields.id,
        guide: {
          url: 'https://dash.cloudflare.com/',
          steps: [
            `Choose the declared Cloudflare account and open the ${manifest.cloudflare.worker} Worker, then Settings → Domains & Routes.`,
            `Check ${hostname} is not in use by another service. If it is, stop and review that owner before changing routing. Otherwise add ${hostname} as a Custom Domain in the ${manifest.cloudflare.zone.name} zone.`,
            'Run pnpm preflight --production again to confirm the provider now reports the intended Worker and zone.',
          ],
        },
      },
    });
  });
}

function variableKey(variable) {
  return variable.environment ? `${variable.environment}:${variable.name}` : variable.name;
}

function variableGuide(manifest, variable, desired) {
  return {
    url: variable.environment
      ? `https://github.com/${manifest.github.repository}/settings/environments`
      : `https://github.com/${manifest.github.repository}/settings/variables/actions`,
    steps: [
      variable.environment
        ? `Open repository Settings → Environments → ${variable.environment} → Environment variables and inspect ${variable.name}.`
        : `Open repository Settings → Secrets and variables → Actions → Variables and inspect ${variable.name}.`,
      desired === undefined
        ? `Set ${variable.name} to the public value appropriate for ${variable.purpose}.`
        : `Set ${variable.name} to ${desired} only after reviewing any existing value.`,
      'Run pnpm preflight --production again to confirm the declared build setting.',
    ],
  };
}

/** Public build settings live in GitHub Actions variables, separate from Worker vars. */
export function planGithubVariables({ manifest, state }) {
  return (manifest.github?.variables ?? []).map((variable) => {
    const fields = {
      id: `github:variable:${variableKey(variable)}`,
      section: 'GitHub variables',
      label: variable.name,
      level: variable.use === 'future' ? 'later' : 'required',
    };
    if (!state.github.ok) return unknownItem({ ...fields, credentialHint: GH_HINT }, state.github);
    const variables = state.github.value.variables;
    if (!variables?.ok)
      return unknownItem(
        { ...fields, credentialHint: GH_HINT },
        variables ?? { reason: 'not read' },
      );
    const desired =
      variable.from === 'cloudflare.accountId' ? manifest.cloudflare.accountId : variable.value;
    const value = variables.value[variableKey(variable)];
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      (desired === undefined || desired === value)
    )
      return item({
        ...fields,
        status: 'ok',
        detail: 'is configured with the declared public setting',
      });
    return item({
      ...fields,
      status: value === undefined || value === '' ? 'missing' : 'mismatch',
      detail:
        value === undefined || value === ''
          ? `is not set; ${variable.purpose}`
          : 'differs from the declared public value',
      next: `${SETUP} shows the reviewed setting; existing values are never overwritten automatically`,
      action: {
        type: 'manual',
        key: fields.id,
        guide: variableGuide(manifest, variable, desired),
      },
    });
  });
}
