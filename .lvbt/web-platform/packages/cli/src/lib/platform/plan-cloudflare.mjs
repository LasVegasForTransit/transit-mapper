import { turnstileGuide } from './guides.mjs';
import { item, manualGuide, SETUP, TOKEN_HINT, unknownItem } from './plan-items.mjs';

/** The Worker, its D1 databases and R2 buckets, and its Turnstile widgets. */

function configItem({ manifest, state, configPath }) {
  const fields = { id: 'config', section: 'Worker', label: configPath };
  const name = manifest.cloudflare.worker;
  if (!state.config.ok)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `cannot read it: ${state.config.reason}`,
      next: 'point cloudflare.wranglerConfig at the production wrangler config',
    });
  if (state.config.value.name !== name)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `names the Worker "${state.config.value.name}", but platform.json says "${name}"`,
      next: 'make the two names agree',
    });
  return item({ ...fields, status: 'ok', detail: `names the Worker ${name}` });
}

export function planWorker(context) {
  const { manifest, state } = context;
  const fields = { id: 'worker', section: 'Worker', label: manifest.cloudflare.worker };
  let deployed;
  if (!state.worker.ok) deployed = unknownItem(fields, state.worker);
  else if (!state.worker.value.exists)
    deployed = item({
      ...fields,
      status: 'missing',
      detail: 'has never been deployed',
      next: 'deploy it once: merge to main, or run pnpm run deploy from a clean checkout of main',
    });
  else deployed = item({ ...fields, status: 'ok', detail: 'is deployed' });
  return [configItem(context), deployed];
}

function databaseItem({ state, configPath }, database) {
  const fields = { id: `d1:${database.name}`, section: 'D1 databases', label: database.name };
  if (!state.d1.ok) return unknownItem(fields, state.d1);
  const real = state.d1.value[database.name];
  if (!real)
    return item({
      ...fields,
      status: 'missing',
      detail: 'does not exist',
      next: `${SETUP} creates it`,
      action: { type: 'd1.create', name: database.name },
    });
  const bound = state.config.ok
    ? state.config.value.d1.find((entry) => entry.binding === database.binding)
    : undefined;
  if (state.config.ok && bound?.name !== database.name)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `${configPath} does not bind ${database.binding} to ${database.name}`,
      next: `add it to d1_databases in ${configPath} with database_id ${real.id}`,
    });
  if (bound && bound.id !== real.id)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `${configPath} has database_id ${bound.id}, but the database is ${real.id}`,
      next: `set database_id to ${real.id} in ${configPath}`,
    });
  return item({ ...fields, status: 'ok', detail: `exists and is bound as ${database.binding}` });
}

function migrationsItem({ state, configPath }, database) {
  const fields = {
    id: `d1:${database.name}:migrations`,
    section: 'D1 databases',
    label: `${database.name} migrations`,
  };
  const files = state.migrations[database.name];
  if (!files?.ok)
    return item({
      ...fields,
      status: 'mismatch',
      detail: `cannot read ${database.migrations}: ${files?.reason ?? 'missing'}`,
      next: 'fix the migrations path in platform.json',
    });
  const action = { type: 'd1.migrate', name: database.name };
  const real = state.d1.ok ? state.d1.value[database.name] : undefined;
  if (state.d1.ok && !real)
    // Wrangler applies migrations to the database_id in the config, so setup
    // applies them after creating the database only if the config names it.
    return item({
      ...fields,
      status: 'missing',
      detail: `${files.value.length} to apply once the database exists and ${configPath} names it`,
      next: `${SETUP} applies them once ${configPath} has the new database's database_id`,
      action: { ...action, binding: database.binding, afterCreate: true },
    });
  if (!real?.applied?.ok) return unknownItem(fields, real?.applied ?? state.d1);
  return pendingItem({ state, configPath }, database, { fields, files: files.value, real, action });
}

/** Migrations against a database that exists: applied, pending, or held back by the config. */
function pendingItem({ state, configPath }, database, { fields, files, real, action }) {
  const pending = files.filter((file) => !real.applied.value.includes(file));
  if (pending.length === 0)
    return item({ ...fields, status: 'ok', detail: `all ${files.length} applied` });
  const bound = state.config.ok
    ? state.config.value.d1.find((entry) => entry.binding === database.binding)
    : undefined;
  if (state.config.ok && bound?.id !== real.id)
    return item({
      ...fields,
      status: 'missing',
      detail: `${pending.length} of ${files.length} not applied; they wait until ${configPath} has database_id ${real.id}`,
      next: `set database_id to ${real.id} in ${configPath}, then run ${SETUP} again`,
    });
  return item({
    ...fields,
    status: 'missing',
    detail: `${pending.length} of ${files.length} not applied: ${pending.join(', ')}`,
    next: `${SETUP} applies them`,
    action,
  });
}

export function planD1(context) {
  return (context.manifest.d1 ?? []).flatMap((database) => [
    databaseItem(context, database),
    ...(database.migrations ? [migrationsItem(context, database)] : []),
  ]);
}

export function planR2({ manifest, state, configPath }) {
  return (manifest.r2 ?? []).map((bucket) => {
    const fields = { id: `r2:${bucket.name}`, section: 'R2 buckets', label: bucket.name };
    if (!state.r2.ok) return unknownItem(fields, state.r2);
    if (!state.r2.value.includes(bucket.name))
      return item({
        ...fields,
        status: 'missing',
        detail: 'does not exist',
        next: `${SETUP} creates it`,
        action: { type: 'r2.create', name: bucket.name },
      });
    const bound = state.config.ok
      ? state.config.value.r2.find((entry) => entry.binding === bucket.binding)
      : undefined;
    if (state.config.ok && bound?.name !== bucket.name)
      return item({
        ...fields,
        status: 'mismatch',
        detail: `${configPath} does not bind ${bucket.binding} to ${bucket.name}`,
        next: `add it to r2_buckets in ${configPath}`,
      });
    return item({ ...fields, status: 'ok', detail: `exists and is bound as ${bucket.binding}` });
  });
}

/** The live widget a manifest entry describes: by name, else by covering its domains. */
export function findWidget(widgets, widget) {
  return (
    widgets.find((candidate) => candidate.name === widget.name) ??
    widgets.find((candidate) =>
      widget.domains.every((domain) => candidate.domains?.includes(domain)),
    )
  );
}

function widgetItem({ manifest, state, configPath }, widget) {
  const fields = { id: `turnstile:${widget.name}`, section: 'Turnstile', label: widget.name };
  const guide = manualGuide(turnstileGuide(widget, manifest.cloudflare, configPath));
  if (!state.turnstile.ok)
    return unknownItem({ ...fields, credentialHint: TOKEN_HINT }, state.turnstile);
  const found = findWidget(state.turnstile.value, widget);
  if (!found)
    return item({
      ...fields,
      status: 'missing',
      detail: `no widget covers ${widget.domains.join(', ')}`,
      next: `${SETUP} creates it`,
      action: { type: 'turnstile.create', widget, guide },
    });
  const lacking = widget.domains.filter((domain) => !found.domains?.includes(domain));
  const mode = widget.mode ?? 'managed';
  if (lacking.length > 0 || found.mode !== mode)
    return item({
      ...fields,
      status: 'mismatch',
      detail:
        lacking.length > 0
          ? `does not cover ${lacking.join(', ')}`
          : `is ${found.mode}, not ${mode}`,
      next: `${SETUP} updates it`,
      action: { type: 'turnstile.update', widget, sitekey: found.sitekey, guide },
    });
  return item({
    ...fields,
    status: 'ok',
    detail: `covers ${widget.domains.join(', ')}; site key ${found.sitekey}`,
  });
}

export function planTurnstile(context) {
  return (context.manifest.turnstile ?? []).map((widget) => widgetItem(context, widget));
}
