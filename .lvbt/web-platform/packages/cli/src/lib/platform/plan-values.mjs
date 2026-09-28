import { emailRecords, resendDomainGuide, varGuide } from './guides.mjs';
import { findApp } from './plan-access.mjs';
import { findWidget } from './plan-cloudflare.mjs';
import { GH_HINT, item, SETUP, targetLabel, unknownItem } from './plan-items.mjs';
import { githubEnvironments } from './observe.mjs';

/** GitHub environments, secrets, vars, email DNS, and the values that must never be set. */

export function planGithubEnvironments({ manifest, state }) {
  return githubEnvironments(manifest).map((environment) => {
    const fields = {
      id: `github:${environment}`,
      section: 'GitHub',
      label: `environment ${environment}`,
    };
    if (!state.github.ok) return unknownItem({ ...fields, credentialHint: GH_HINT }, state.github);
    if (state.github.value.environments.includes(environment))
      return item({ ...fields, status: 'ok', detail: `exists in ${manifest.github.repository}` });
    return item({
      ...fields,
      status: 'missing',
      detail: `does not exist in ${manifest.github.repository}`,
      next: `${SETUP} creates it`,
      action: { type: 'github.environment', environment },
    });
  });
}

/** Where a secret's value comes from when setup stores it. */
export function secretSource(secret, manifest) {
  if (secret.generate) return { type: 'generate' };
  if (secret.from === 'cloudflare.accountId')
    return {
      type: 'value',
      value: manifest.cloudflare.accountId,
      from: 'the Cloudflare account ID',
    };
  const widget = (manifest.turnstile ?? []).find((candidate) => candidate.secret === secret.name);
  if (widget) return { type: 'turnstile', widget, from: `the ${widget.name} Turnstile widget` };
  for (const app of manifest.access ?? []) {
    if (app.teamDomainSecret === secret.name)
      return { type: 'access-team', app, from: 'the Zero Trust team domain' };
    if (app.audienceSecret === secret.name)
      return { type: 'access-audience', app, from: `the ${app.name} Access application` };
  }
  return { type: 'prompt' };
}

/** Whether a secret is a credential, which is typed hidden and never shown. */
export function isSensitive(secret) {
  return secret?.sensitive !== false;
}

/** The value setup would store for a non-credential secret, when it can know it. */
function knownPlainValue(secret, source, state) {
  if (isSensitive(secret)) return undefined;
  if (source.type === 'value') return source.value;
  if (!state.access.ok) return undefined;
  if (source.type === 'access-team') return state.access.value.teamDomain;
  if (source.type === 'access-audience') return findApp(state.access.value.apps, source.app)?.aud;
  return undefined;
}

function sourceHint(source) {
  if (source.type === 'generate') return `${SETUP} generates and stores it`;
  if (source.type === 'prompt') return `${SETUP} asks for it, with steps`;
  return `${SETUP} copies it from ${source.from}`;
}

/** Whether `name` is stored at `target`: an observation of true or false. */
function stored(state, target, name) {
  if (target === 'worker') {
    if (!state.worker.ok) return state.worker;
    if (!state.worker.value.exists)
      return { ok: false, blocked: true, reason: "waits for the Worker's first deploy" };
    return { ok: true, value: state.worker.value.secrets.includes(name) };
  }
  if (!state.github.ok) return { ...state.github, credentialHint: GH_HINT };
  return { ok: true, value: state.github.value.secrets[target.slice(7)]?.includes(name) ?? false };
}

function secretItem({ manifest, state }, secret, target) {
  const fields = {
    id: `secret:${secret.name}:${target}`,
    section: 'Secrets',
    label: `${secret.name} → ${targetLabel(manifest, target)}`,
    level: secret.use === 'future' ? 'later' : 'required',
  };
  const present = stored(state, target, secret.name);
  if (present.blocked)
    return item({
      ...fields,
      status: 'missing',
      detail: present.reason,
      next: 'deploy the Worker first',
    });
  if (!present.ok)
    return unknownItem({ ...fields, credentialHint: present.credentialHint }, present);
  const source = secretSource(secret, manifest);
  const plain = knownPlainValue(secret, source, state);
  if (present.value)
    // Setup cannot read a stored value back, so for a non-credential it shows
    // the value that belongs there, for a person to compare.
    return item({
      ...fields,
      status: 'ok',
      detail: plain === undefined ? 'is set' : `is set; it should be ${plain}`,
    });
  const elsewhere = (secret.targets ?? ['worker']).filter(
    (other) => other !== target && stored(state, other, secret.name).value === true,
  );
  if (source.type === 'generate' && elsewhere.length > 0)
    // A generated value cannot be read back, so minting another here would
    // leave the targets holding different values.
    return item({
      ...fields,
      status: 'mismatch',
      detail: `is not set here but is set on ${elsewhere.map((other) => targetLabel(manifest, other)).join(', ')}, and setup cannot read that value to copy it`,
      next: `${SETUP} --rotate ${secret.name} stores one new value everywhere`,
    });
  return item({
    ...fields,
    status: 'missing',
    detail: secret.neededFor
      ? `is not set; needed for ${secret.neededFor}`
      : `is not set. ${secret.purpose}`,
    next: plain === undefined ? sourceHint(source) : `${sourceHint(source)}: ${plain}`,
    action: { type: 'secret.put', secret, target, source },
  });
}

export function planSecrets(context) {
  return (context.manifest.secrets ?? []).flatMap((secret) =>
    (secret.targets ?? ['worker']).map((target) => secretItem(context, secret, target)),
  );
}

export function planVars({ manifest, state, configPath }) {
  return (manifest.vars ?? []).map((variable) => {
    const fields = {
      id: `var:${variable.name}`,
      section: 'Vars',
      label: variable.name,
      level: variable.use === 'future' ? 'later' : 'required',
    };
    if (!state.config.ok)
      return item({
        ...fields,
        status: 'unknown',
        detail: `cannot read ${configPath}`,
        next: 'fix the wrangler config path',
      });
    const widget = (manifest.turnstile ?? []).find(
      (candidate) => candidate.siteKeyVar === variable.name,
    );
    const live =
      widget && state.turnstile.ok ? findWidget(state.turnstile.value, widget) : undefined;
    const value = state.config.value.vars[variable.name];
    const action = {
      type: 'manual',
      key: `var:${variable.name}`,
      guide: varGuide(variable, configPath, live?.sitekey, widget?.name),
      variable,
      widget: widget?.name,
    };
    if (value === undefined || value === '')
      return item({
        ...fields,
        status: 'missing',
        detail: `is not in vars in ${configPath}`,
        next: `add it to vars in ${configPath}${live ? ` as "${live.sitekey}"` : ''}`,
        action,
      });
    if (live && value !== live.sitekey)
      return item({
        ...fields,
        status: 'mismatch',
        detail: `is ${value}, but the ${widget.name} widget's site key is ${live.sitekey}`,
        next: `set it to "${live.sitekey}" in ${configPath}`,
        action,
      });
    return item({ ...fields, status: 'ok', detail: `is set in ${configPath}` });
  });
}

export function planEmail({ manifest, state }) {
  return (manifest.email ?? []).flatMap((email) => {
    const guide = resendDomainGuide(email, manifest.cloudflare);
    return emailRecords(email).map((record) => {
      const fields = {
        id: `email:${email.domain}:${record.key}`,
        section: 'Email',
        label: `${record.type} ${record.name}`,
        level: record.level,
      };
      const answers = state.dns[`${record.name} ${record.type}`] ?? {
        ok: false,
        reason: 'not looked up',
      };
      if (!answers.ok) return unknownItem(fields, answers);
      if (answers.value.some(record.matches))
        return item({ ...fields, status: 'ok', detail: record.purpose });
      return item({
        ...fields,
        status: 'missing',
        detail: `is missing; it ${record.purpose}. Expected ${record.expected}`,
        next: `verify ${email.domain} in Resend; ${SETUP} shows the steps`,
        action: { type: 'manual', key: `email:${email.domain}`, guide },
      });
    });
  });
}

function workerForbidden({ state, configPath }, entry, fields) {
  const deployed = state.worker.ok && state.worker.value.exists ? state.worker.value : undefined;
  const found = (detail, next, action) =>
    item({ ...fields, status: 'forbidden', detail: `${detail}. ${entry.reason}`, next, action });
  if (deployed?.secrets.includes(entry.name))
    return found('is set as a secret', `${SETUP} offers to delete it`, {
      type: 'secret.delete',
      name: entry.name,
      target: 'worker',
    });
  if (state.config.ok && entry.name in state.config.value.vars)
    return found(
      `is in vars in ${configPath}`,
      `remove it from vars in ${configPath}, then deploy`,
    );
  if (deployed && entry.name in deployed.vars)
    return found(
      'is still a var on the deployed Worker',
      'deploy from main again; a deploy replaces every var',
    );
  if (!state.worker.ok) return unknownItem(fields, state.worker);
  return item({ ...fields, status: 'ok', detail: 'is not set' });
}

function githubForbidden({ state }, entry, fields, environment) {
  if (!state.github.ok) return unknownItem({ ...fields, credentialHint: GH_HINT }, state.github);
  if (!state.github.value.secrets[environment]?.includes(entry.name))
    return item({ ...fields, status: 'ok', detail: 'is not set' });
  return item({
    ...fields,
    status: 'forbidden',
    detail: `is set in the ${environment} environment. ${entry.reason}`,
    next: `${SETUP} offers to delete it`,
    action: { type: 'secret.delete', name: entry.name, target: `github:${environment}` },
  });
}

export function planForbidden(context) {
  const { manifest } = context;
  return (manifest.forbidden ?? []).flatMap((entry) =>
    (entry.targets ?? ['worker']).map((target) => {
      const fields = {
        id: `forbidden:${entry.name}:${target}`,
        section: 'Must not be set',
        label: `${entry.name} on ${targetLabel(manifest, target)}`,
        level: entry.severity === 'warning' ? 'recommended' : 'required',
      };
      return target === 'worker'
        ? workerForbidden(context, entry, fields)
        : githubForbidden(context, entry, fields, target.slice(7));
    }),
  );
}
