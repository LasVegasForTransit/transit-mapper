import { SETUP } from './plan.mjs';
import { paint } from './terminal.mjs';
import { account, manualStep, storeFed, succeeded, targetName, wrangler } from './apply-steps.mjs';

/**
 * The resources setup creates or fixes: D1 databases and their migrations,
 * R2 buckets, Turnstile widgets, Access applications with their allow
 * policies, GitHub environments, and forbidden secrets it deletes.
 */

export async function createWidget(context, action) {
  const api = await context.setupApi();
  if (!api)
    return manualStep(context, {
      key: `turnstile:${action.widget.name}`,
      title: `Create the Turnstile widget ${action.widget.name}`,
      guide: action.guide,
    });
  const { widget } = action;
  const created = await api.post(`${account(context)}/challenges/widgets`, {
    name: widget.name,
    domains: widget.domains,
    mode: widget.mode ?? 'managed',
  });
  context.created.widgets.set(widget.name, created);
  context.io.write(`${paint('green', 'Created')} the Turnstile widget ${widget.name}.\n`);
  context.io.write(
    `Put "${widget.siteKeyVar}": "${created.sitekey}" in vars in ${context.configPath}, commit it, and deploy. The site key is public.\n`,
  );
  await storeFed(context, widget.secret, created.secret);
}

const WIDGET_SETTINGS = ['bot_fight_mode', 'clearance_level', 'ephemeral_id', 'offlabel', 'region'];

export async function updateWidget(context, action) {
  const api = await context.setupApi();
  if (!api)
    return manualStep(context, {
      key: `turnstile:${action.widget.name}`,
      title: `Update the Turnstile widget ${action.widget.name}`,
      guide: action.guide,
    });
  const current = await api.get(`${account(context)}/challenges/widgets/${action.sitekey}`);
  // A PUT replaces the whole widget, so carry every setting this does not manage.
  const kept = Object.fromEntries(
    Object.entries(current ?? {}).filter(([key]) => WIDGET_SETTINGS.includes(key)),
  );
  await api.put(`${account(context)}/challenges/widgets/${action.sitekey}`, {
    ...kept,
    name: current.name,
    domains: [...new Set([...(current.domains ?? []), ...action.widget.domains])],
    mode: action.widget.mode ?? 'managed',
  });
  context.io.write(`${paint('green', 'Updated')} the Turnstile widget ${action.widget.name}.\n`);
}

/** Whether a policy attached to an application lets everyone in. */
function allowsEveryone(policy, reusable) {
  const full = policy.include ? policy : reusable.find((candidate) => candidate.id === policy.id);
  return full?.decision === 'allow' && (full.include ?? []).some((rule) => 'everyone' in rule);
}

function appBody({ app, provider, policyId, base = {}, reusable = [] }) {
  const existing = base.destinations ?? [];
  const covered = new Set(existing.map((destination) => destination.uri));
  return {
    name: base.name ?? app.name,
    type: 'self_hosted',
    domain: base.domain ?? app.destinations[0],
    destinations: [
      ...existing,
      ...app.destinations
        .filter((uri) => !covered.has(uri))
        .map((uri) => ({ type: 'public', uri })),
    ],
    session_duration: app.sessionDuration ?? '24h',
    allowed_idps: [provider.id],
    auto_redirect_to_identity: true,
    app_launcher_visible: base.app_launcher_visible ?? false,
    policies: [
      { id: policyId, precedence: 1 },
      // An allow policy that admits everyone is the mismatch being fixed, so
      // it is detached; keeping it would leave the application open.
      ...(base.policies ?? [])
        .filter((policy) => policy.id !== policyId && !allowsEveryone(policy, reusable))
        .map((policy, index) => ({ id: policy.id, precedence: index + 2 })),
    ],
  };
}

async function allowPolicy(context, api, action) {
  const name = `${action.app.name} allow`;
  const existing = context.state.access.ok
    ? context.state.access.value.policies.find((policy) => policy.name === name)
    : undefined;
  if (existing) {
    const same =
      existing.decision === 'allow' &&
      JSON.stringify(existing.include ?? []) === JSON.stringify(action.rule);
    if (!same)
      await api.put(`${account(context)}/access/policies/${existing.id}`, {
        name,
        decision: 'allow',
        include: action.rule,
      });
    return existing.id;
  }
  const created = await api.post(`${account(context)}/access/policies`, {
    name,
    decision: 'allow',
    include: action.rule,
  });
  return created.id;
}

export async function createOrUpdateApp(context, action) {
  const api = await context.setupApi();
  const title = `${action.found ? 'Fix' : 'Create'} the Access application ${action.app.name}`;
  if (!api)
    return manualStep(context, { key: `access:${action.app.name}`, title, guide: action.guide });
  const policyId = await allowPolicy(context, api, action);
  const reusable = context.state.access.ok ? context.state.access.value.policies : [];
  const result = action.found
    ? await api.put(
        `${account(context)}/access/apps/${action.found.id}`,
        appBody({
          app: action.app,
          provider: action.provider,
          policyId,
          base: action.found,
          reusable,
        }),
      )
    : await api.post(
        `${account(context)}/access/apps`,
        appBody({ app: action.app, provider: action.provider, policyId }),
      );
  context.created.apps.set(action.app.name, result);
  context.io.write(
    `${paint('green', action.found ? 'Updated' : 'Created')} the Access application ${action.app.name}.\n`,
  );
  // A new application has a new audience tag, so any stored one is stale.
  // The team domain has not changed; its own item stores it only if missing.
  if (!action.found) await storeFed(context, action.app.audienceSecret, result.aud);
}

export async function deleteSecret(context, action) {
  const where = targetName(context, action.target);
  if (!(await context.io.confirm(`Delete ${action.name} from ${where}?`, true))) return;
  const result =
    action.target === 'worker'
      ? wrangler(
          context,
          ['secret', 'delete', action.name, '--name', context.manifest.cloudflare.worker],
          { inherit: true },
        )
      : context.run(
          'gh',
          [
            'secret',
            'delete',
            action.name,
            '--env',
            action.target.slice(7),
            '--repo',
            context.manifest.github.repository,
          ],
          { cwd: context.directory },
        );
  succeeded(result);
  context.io.write(`${paint('green', 'Deleted')} ${action.name} from ${where}.\n`);
}

/**
 * Whether the config names the database this run created. Wrangler applies
 * migrations to the config's database_id, so until a pull request puts the
 * new id there, applying them would reach the wrong database or none.
 */
export async function namedInConfig(context, action) {
  const state = context.observe ? await context.observe() : context.state;
  const real = state.d1.ok ? state.d1.value[action.name] : undefined;
  const bound = state.config.ok
    ? state.config.value.d1.find((entry) => entry.binding === action.binding)
    : undefined;
  if (real && bound?.id === real.id) return true;
  context.io.write(
    `The migrations for ${action.name} wait until ${context.configPath} has database_id ${real?.id ?? 'of the new database'}. Run ${SETUP} again after that pull request merges.\n`,
  );
  return false;
}
