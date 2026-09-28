import { accessAppGuide, teamDomainGuide, turnstileGuide } from './guides.mjs';
import { findApp, findWidget, isSensitive, secretSource } from './plan.mjs';
import { paint } from './terminal.mjs';
import { account, generateSecret, printGuide, storeSecret, targetName } from './apply-steps.mjs';

/**
 * Where a secret's value comes from when setup stores it: a new random
 * value, one a resource already has, or one a person pastes. Also the
 * explicit replacement that --rotate asks for.
 */

function skipNote(secret) {
  return secret.use === 'future'
    ? 'Only a feature that is not built yet needs it, so it is fine to skip it now. This command asks again next time.'
    : 'Production is not ready without it. If you cannot get it now, press Enter to skip; this command asks again next time.';
}

/**
 * Ask a person for a value. A value a resource feeds (a Turnstile widget or
 * an Access application) always gets the standard's reviewed steps; a value
 * only a person knows gets the steps its manifest gives.
 */
async function promptValue(context, secret, standard) {
  const { io } = context;
  io.write(`\n${paint('bold', secret.name)}: ${secret.purpose}\n`);
  if (secret.neededFor) io.write(`Needed for ${secret.neededFor}.\n`);
  io.write(`${skipNote(secret)}\n`);
  const guide = standard ?? { url: secret.url, steps: secret.steps ?? [] };
  printGuide(io, guide);
  if (guide.url && (await io.confirm('Open that page in your browser?', true))) io.open(guide.url);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = isSensitive(secret)
      ? await io.askHidden(`Paste ${secret.name} (hidden; leave empty to skip for now): `)
      : await io.ask(`Paste ${secret.name} (leave empty to skip for now): `);
    if (!value) return undefined;
    if (!secret.pattern || new RegExp(secret.pattern, 'u').test(value)) return value;
    io.write(
      `That does not look right. ${secret.patternHint ?? `It should match ${secret.pattern}.`}\n`,
    );
  }
  return undefined;
}

async function readWidgetSecret(context, widget) {
  const created = context.created.widgets.get(widget.name);
  if (created?.secret) return created.secret;
  const api = await context.setupApi();
  if (!api) return undefined;
  const found = findWidget(await api.list(`${account(context)}/challenges/widgets`), widget);
  return found
    ? (await api.get(`${account(context)}/challenges/widgets/${found.sitekey}`))?.secret
    : undefined;
}

/** The standard's steps for a value a resource feeds, shortened when this run already showed them. */
function fedGuide(context, source) {
  const { manifest, configPath } = context;
  if (source.type === 'turnstile') {
    const guide = turnstileGuide(source.widget, manifest.cloudflare, configPath);
    return context.shown.has(`turnstile:${source.widget.name}`)
      ? { url: guide.url, steps: guide.secretSteps }
      : guide;
  }
  if (source.type === 'access-team') return teamDomainGuide(source.app.teamDomainSecret);
  if (source.type === 'access-audience') {
    const guide = accessAppGuide(source.app, manifest.cloudflare.zone.name);
    return context.shown.has(`access:${source.app.name}`)
      ? { url: guide.url, steps: guide.audienceSteps }
      : guide;
  }
  return undefined;
}

/** The value a resource or the manifest already has, without asking anyone. */
async function knownValue(context, source) {
  if (source.type === 'value') return source.value;
  if (source.type === 'turnstile') return readWidgetSecret(context, source.widget);
  if (source.type === 'access-team')
    return context.state.access.ok ? context.state.access.value.teamDomain : undefined;
  if (source.type === 'access-audience') {
    const created = context.created.apps.get(source.app.name);
    return (
      created?.aud ??
      (context.state.access.ok
        ? findApp(context.state.access.value.apps, source.app)?.aud
        : undefined)
    );
  }
  return undefined;
}

export async function secretValue(context, action) {
  const { secret, source } = action;
  if (context.values.has(secret.name)) return context.values.get(secret.name);
  let value;
  if (source.type === 'generate') {
    // The plan offers this only when no target holds a value yet, so every
    // target this run stores gets the same new value.
    value = generateSecret();
    context.io.write(`Generated a new random value for ${secret.name}.\n`);
  } else {
    value = await knownValue(context, source);
  }
  if (!value) value = await promptValue(context, secret, fedGuide(context, source));
  if (value) context.values.set(secret.name, value);
  return value;
}

/** The targets of a rotated secret that this run has not already stored. */
function rotationTargets(context, secret) {
  const targets = (secret.targets ?? ['worker']).filter(
    (target) => !context.handled.has(`secret:${secret.name}:${target}`),
  );
  const deployed = context.state.worker.ok && context.state.worker.value.exists;
  for (const target of targets.filter((target) => target === 'worker' && !deployed))
    context.io.write(
      `\n${secret.name} cannot be replaced on ${targetName(context, target)} before its first deploy.\n`,
    );
  return targets.filter((target) => target !== 'worker' || deployed);
}

/** A new value for a rotated secret, or undefined when the person keeps the old one. */
async function rotatedValue(context, secret) {
  const source = secretSource(secret, context.manifest);
  if (source.type === 'generate') return generateSecret();
  return (
    (await knownValue(context, source)) ??
    (await promptValue(context, secret, fedGuide(context, source)))
  );
}

async function rotateSecret(context, secret) {
  const { io } = context;
  const targets = rotationTargets(context, secret);
  if (targets.length === 0) return;
  const where = targets.map((target) => targetName(context, target)).join(' and ');
  io.write(`\n${paint('bold', `Replace ${secret.name}`)}\n`);
  const question = `Replace ${secret.name} on ${where}? Anything still using the old value stops working until it has the new one.`;
  if (!(await io.confirm(question, true))) return;
  const value = await rotatedValue(context, secret);
  if (!value) {
    io.write(`Kept the current ${secret.name}.\n`);
    return;
  }
  for (const target of targets) {
    try {
      await storeSecret(context, secret.name, target, value);
    } catch (error) {
      io.write(
        `${paint('red', 'Could not')} replace ${secret.name} on ${targetName(context, target)}: ${error.message}\n`,
      );
    }
  }
}

/**
 * Replace the stored value of each named secret on every target, when the
 * person asked for it with --rotate. A generated secret gets a new random
 * value; a typed one is asked for again; one a resource feeds is copied from
 * the resource again. A target this run already stored is left alone, since
 * its value is new. Nothing is replaced without that flag.
 */
export async function rotateSecrets(context, names) {
  for (const name of names)
    await rotateSecret(
      context,
      context.manifest.secrets.find((secret) => secret.name === name),
    );
}
