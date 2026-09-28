import {
  accessAppGuide,
  googleGroupGuide,
  googleWorkspaceGuide,
  ZERO_TRUST,
  zeroTrustGuide,
} from './guides.mjs';
import { item, manualGuide, SETUP, TOKEN_HINT, unknownItem } from './plan-items.mjs';

/**
 * Cloudflare Access: Zero Trust itself, the identity provider people sign in
 * with, and each application with its allow policy.
 */

const SECTION = 'Access';

/** The Access rule that admits the people a manifest entry allows. */
export function allowRule(allow, provider) {
  if (allow.googleGroup)
    return [{ gsuite: { email: allow.googleGroup, identity_provider_id: provider?.id } }];
  if (allow.emailDomain) return [{ email_domain: { domain: allow.emailDomain } }];
  return allow.emails.map((email) => ({ email: { email } }));
}

const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

function includesAllow(include, allow) {
  const rules = include ?? [];
  if (allow.googleGroup) return rules.some((rule) => same(rule.gsuite?.email, allow.googleGroup));
  if (allow.emailDomain)
    return rules.some((rule) => same(rule.email_domain?.domain, allow.emailDomain));
  return allow.emails.every((email) => rules.some((rule) => same(rule.email?.email, email)));
}

export function appDestinations(found) {
  return new Set([
    ...(found.destinations ?? [])
      .filter((destination) => !destination.type || destination.type === 'public')
      .map((destination) => destination.uri),
    ...(found.self_hosted_domains ?? []),
    ...(found.domain ? [found.domain] : []),
  ]);
}

/** The live application a manifest entry describes: by name, else by a shared path. */
export function findApp(apps, app) {
  return (
    apps.find((candidate) => candidate.name === app.name) ??
    apps.find((candidate) =>
      app.destinations.some((destination) => appDestinations(candidate).has(destination)),
    )
  );
}

function policyReasons(found, app, reusable) {
  const policies = (found.policies ?? [])
    .map((policy) =>
      policy.include ? policy : reusable.find((candidate) => candidate.id === policy.id),
    )
    .filter(Boolean);
  const allows = policies.filter((policy) => policy.decision === 'allow');
  const reasons = [];
  if (allows.some((policy) => (policy.include ?? []).some((rule) => 'everyone' in rule)))
    reasons.push('has an allow policy that lets everyone in');
  if (!allows.some((policy) => includesAllow(policy.include, app.allow)))
    reasons.push('has no allow policy for the declared people');
  return reasons;
}

/** Why a live Access application differs from the manifest, as readable reasons. */
export function accessDifferences(found, app, provider, reusable) {
  const reasons = [];
  const destinations = appDestinations(found);
  const lacking = app.destinations.filter((destination) => !destinations.has(destination));
  if (lacking.length > 0) reasons.push(`does not protect ${lacking.join(', ')}`);
  const session = app.sessionDuration ?? '24h';
  if (found.session_duration && found.session_duration !== session)
    reasons.push(`signs people in for ${found.session_duration}, not ${session}`);
  if (provider && found.allowed_idps?.length > 0 && !found.allowed_idps.includes(provider.id))
    reasons.push(`does not offer the ${app.identityProvider} identity provider`);
  else if (provider && Array.isArray(found.allowed_idps) && found.allowed_idps.length === 0)
    reasons.push(`accepts every identity provider, not only ${app.identityProvider}`);
  return [...reasons, ...policyReasons(found, app, reusable)];
}

function providerItem(manifest, access, type) {
  const provider = access.providers.find((candidate) => candidate.type === type);
  const fields = {
    id: `access:idp:${type}`,
    section: SECTION,
    label: type === 'google-apps' ? 'Google Workspace sign-in' : 'One-time PIN sign-in',
  };
  if (provider)
    return item({ ...fields, status: 'ok', detail: `identity provider "${provider.name}"` });
  const group = manifest.access.find((app) => app.allow.googleGroup)?.allow.googleGroup;
  const guide =
    type === 'google-apps'
      ? googleWorkspaceGuide(access.teamDomain, group?.split('@')[1], group)
      : {
          url: ZERO_TRUST,
          steps: [
            'Open Cloudflare One and choose the LVBT account.',
            'Go to Integrations → Identity providers (not "Cloud & SaaS" just above it: that is a different feature that asks for a service account; leave it alone), click "Add new identity provider", choose "One-time PIN", and click "Save". People then sign in with a code emailed to them.',
          ],
        };
  return item({
    ...fields,
    status: 'missing',
    detail: 'is not an identity provider yet',
    next: `add it in the dashboard; ${SETUP} shows the steps`,
    action: { type: 'manual', key: `idp:${type}`, guide },
  });
}

function applicationItem(manifest, access, app) {
  const fields = { id: `access:${app.name}`, section: SECTION, label: app.name };
  const provider = access.providers.find((candidate) => candidate.type === app.identityProvider);
  const found = findApp(access.apps, app);
  const shared = {
    app,
    provider,
    rule: allowRule(app.allow, provider),
    guide: manualGuide(accessAppGuide(app, manifest.cloudflare.zone.name)),
  };
  if (!found && !provider)
    return item({
      ...fields,
      status: 'missing',
      detail: 'waits for the identity provider',
      next: `run ${SETUP} again after the identity provider is added`,
    });
  if (!found)
    return item({
      ...fields,
      status: 'missing',
      detail: `nothing protects ${app.destinations.join(', ')}`,
      next: `${SETUP} creates the application and its allow policy`,
      action: { type: 'access.create', ...shared },
    });
  const reasons = accessDifferences(found, app, provider, access.policies);
  if (reasons.length > 0 && !provider)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `${reasons.join('; ')}; it also waits for the identity provider`,
      next: `run ${SETUP} again after the identity provider is added`,
    });
  if (reasons.length > 0)
    return item({
      ...fields,
      status: 'mismatch',
      detail: reasons.join('; '),
      next: `${SETUP} updates it`,
      action: { type: 'access.update', found, ...shared },
    });
  const people = app.allow.googleGroup ?? app.allow.emailDomain ?? app.allow.emails.join(', ');
  return item({
    ...fields,
    status: 'ok',
    detail: `protects ${app.destinations.length} paths for ${people}`,
  });
}

/**
 * Each Google Group an application admits. Setup cannot read Google Groups,
 * so a group is ready once a person confirms it exists, which setup then
 * remembers on that computer. It only warns, because a check in CI cannot
 * ask anyone.
 */
function groupItems({ manifest, state }) {
  const groups = new Map();
  for (const app of manifest.access ?? []) {
    const group = app.allow.googleGroup;
    if (group) groups.set(group, [...(groups.get(group) ?? []), app]);
  }
  return [...groups].map(([group, apps]) => {
    const key = `google-group:${manifest.cloudflare.accountId}:${group}`;
    const fields = {
      id: `google-group:${group}`,
      section: SECTION,
      label: `Google Group ${group}`,
      level: 'recommended',
    };
    if (state.confirmed?.has(key))
      return item({ ...fields, status: 'ok', detail: 'was confirmed to exist on this computer' });
    return item({
      ...fields,
      status: 'missing',
      detail: 'is not confirmed to exist; setup cannot read Google Groups',
      next: `${SETUP} shows how to create it, then asks`,
      action: {
        type: 'manual',
        key: `google-group:${group}`,
        guide: googleGroupGuide(group, apps),
        confirm: {
          key,
          question: `Does the Google Group ${group} exist now, with the people who need in?`,
        },
      },
    });
  });
}

export function planAccess({ manifest, state }) {
  const apps = manifest.access ?? [];
  if (apps.length === 0) return [];
  const groups = groupItems({ manifest, state });
  if (!state.access.ok)
    return [
      unknownItem(
        { id: 'access', section: SECTION, label: 'Zero Trust', credentialHint: TOKEN_HINT },
        state.access,
      ),
      ...groups,
    ];
  const access = state.access.value;
  const zeroTrust = { id: 'access:zero-trust', section: SECTION, label: 'Zero Trust' };
  if (!access.enabled)
    return [
      item({
        ...zeroTrust,
        status: 'missing',
        detail: 'is not turned on for this account',
        next: `turn it on in the dashboard; ${SETUP} shows the steps`,
        action: { type: 'manual', key: 'zero-trust', guide: zeroTrustGuide(manifest) },
      }),
      ...groups,
      ...apps.map((app) =>
        item({
          id: `access:${app.name}`,
          section: SECTION,
          label: app.name,
          status: 'missing',
          detail: 'waits for Zero Trust',
          next: `run ${SETUP} again after Zero Trust is on`,
        }),
      ),
    ];
  return [
    item({
      ...zeroTrust,
      status: 'ok',
      detail: `is on; team domain ${access.teamDomain ?? 'unknown'}${access.teamName ? ` (team name "${access.teamName}")` : ''}`,
    }),
    ...[...new Set(apps.map((app) => app.identityProvider))].map((type) =>
      providerItem(manifest, access, type),
    ),
    ...groups,
    ...apps.map((app) => applicationItem(manifest, access, app)),
  ];
}
