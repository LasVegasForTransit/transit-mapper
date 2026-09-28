import { varGuide } from './guides.mjs';
import { SETUP } from './plan.mjs';
import { paint } from './terminal.mjs';
import { manualStep, storeSecret, succeeded, wrangler } from './apply-steps.mjs';
import {
  createOrUpdateApp,
  createWidget,
  deleteSecret,
  namedInConfig,
  updateWidget,
} from './apply-resources.mjs';
import { secretValue } from './apply-values.mjs';

export { generateSecret, targetName } from './apply-steps.mjs';
export { rotateSecrets } from './apply-values.mjs';

/**
 * Carry out a plan: create what is missing, store secrets, and walk a person
 * through the steps only a dashboard can do. Each step acts only on an item
 * the plan found open, so running setup again after a failure or a skipped
 * step picks up exactly the items that are still open.
 */

async function createDatabase(context, action) {
  succeeded(wrangler(context, ['d1', 'create', action.name]));
  context.io.write(
    `${paint('green', 'Created')} the D1 database ${action.name}. Put its database_id in ${context.configPath} through a pull request; the final report shows the id.\n`,
  );
}

async function migrateDatabase(context, action) {
  if (action.afterCreate && !(await namedInConfig(context, action))) return;
  context.io.write(
    `Applying migrations to ${action.name}. Wrangler lists them and asks you to confirm.\n`,
  );
  succeeded(
    wrangler(context, ['d1', 'migrations', 'apply', action.name, '--remote'], { inherit: true }),
  );
}

async function createBucket(context, action) {
  succeeded(wrangler(context, ['r2', 'bucket', 'create', action.name]));
  context.io.write(`${paint('green', 'Created')} the R2 bucket ${action.name}.\n`);
}

async function createEnvironment(context, action) {
  const repository = context.manifest.github.repository;
  succeeded(
    context.run(
      'gh',
      ['api', '--method', 'PUT', `repos/${repository}/environments/${action.environment}`],
      { cwd: context.directory },
    ),
  );
  context.io.write(`${paint('green', 'Created')} the GitHub environment ${action.environment}.\n`);
}

async function putSecret(context, action) {
  if (context.handled.has(`secret:${action.secret.name}:${action.target}`)) return;
  const value = await secretValue(context, action);
  if (!value) {
    context.io.write(`Skipped ${action.secret.name}. Run ${SETUP} again to set it.\n`);
    return;
  }
  await storeSecret(context, action.secret.name, action.target, value);
}

async function showSteps(context, action, entry) {
  // A widget created earlier in this run has a site key the plan could not know.
  const created = action.widget && context.created.widgets.get(action.widget);
  const guide = created
    ? varGuide(action.variable, context.configPath, created.sitekey, action.widget)
    : action.guide;
  await manualStep(context, {
    key: action.key,
    title: `${entry.label} ${entry.detail}`,
    guide,
    confirm: action.confirm,
  });
}

const HANDLERS = {
  'd1.create': createDatabase,
  'd1.migrate': migrateDatabase,
  'r2.create': createBucket,
  'turnstile.create': createWidget,
  'turnstile.update': updateWidget,
  'access.create': createOrUpdateApp,
  'access.update': createOrUpdateApp,
  'github.environment': createEnvironment,
  'secret.put': putSecret,
  'secret.delete': deleteSecret,
  manual: showSteps,
};

async function perform(context, entry) {
  const handler = HANDLERS[entry.action.type];
  if (!handler) throw new Error(`unknown action ${entry.action.type}`);
  await handler(context, entry.action, entry);
}

export function describeAction(entry) {
  const { action } = entry;
  switch (action.type) {
    case 'd1.create':
      return `create the D1 database ${action.name}`;
    case 'd1.migrate':
      return `apply the migrations to ${action.name}`;
    case 'r2.create':
      return `create the R2 bucket ${action.name}`;
    case 'turnstile.create':
      return `create the Turnstile widget ${action.widget.name} and store its secret`;
    case 'turnstile.update':
      return `update the Turnstile widget ${action.widget.name}`;
    case 'access.create':
      return `create the Access application ${action.app.name} and its allow policy`;
    case 'access.update':
      return `fix the Access application ${action.app.name}`;
    case 'github.environment':
      return `create the GitHub environment ${action.environment}`;
    case 'secret.put':
      return `${action.source.type === 'prompt' ? 'ask for' : 'store'} ${action.secret.name} on ${action.target === 'worker' ? 'the Worker' : `GitHub ${action.target.slice(7)}`}`;
    case 'secret.delete':
      return `offer to delete ${action.name}`;
    default:
      return `show the steps for ${entry.label}`;
  }
}

/**
 * Work through every open item that has an action. Items for features that
 * are not built yet are offered separately, after asking.
 */
export async function applyPlan(context, items) {
  const { io } = context;
  if (items.every((entry) => entry.status === 'ok')) {
    io.write('\nEverything platform.json declares is already in place. Nothing was changed.\n');
    return { acted: false };
  }
  const open = items.filter((entry) => entry.status !== 'ok' && entry.action);
  const later = open.filter((entry) => entry.level === 'later');
  let work = open.filter((entry) => entry.level !== 'later');
  if (later.length > 0) {
    io.write(
      `\n${later.length} item(s) are only needed by features that are not built yet: ${later.map((entry) => entry.label).join(', ')}.\n`,
    );
    if (await io.confirm('Set those up now too?', false)) work = open;
  }
  if (work.length === 0) {
    io.write(
      '\nNothing else can be set up from here, and nothing was changed. The report above says what is left.\n',
    );
    return { acted: false };
  }
  io.write('\nSetup will now, in this order:\n');
  const described = [...new Set(work.map(describeAction))];
  for (const line of described) io.write(`  - ${line}\n`);
  if (!(await io.confirm('Start?', true))) return { acted: false };
  for (const entry of work) {
    try {
      await perform(context, entry);
    } catch (error) {
      io.write(`${paint('red', 'Could not')} ${describeAction(entry)}: ${error.message}\n`);
    }
  }
  return { acted: true };
}
