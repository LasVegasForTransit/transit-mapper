import { item, SETUP, TOKEN_HINT, unknownItem } from './plan-items.mjs';

function agrees(kind, actual, expected) {
  if (kind === 'analyticsEngine') return actual.name === expected.name;
  return (
    actual.namespace === expected.namespace &&
    actual.simple?.limit === expected.simple.limit &&
    actual.simple?.period === expected.simple.period
  );
}
function manualBindingAction({ manifest, configPath }, fields, kind, declaration) {
  const requirement =
    kind === 'analyticsEngine'
      ? `Bind ${declaration.binding} to Analytics Engine dataset ${declaration.name}. The dataset is created automatically on its first authorized write; selecting a binding is not proof of event delivery.`
      : `Bind ${declaration.binding} to rate-limit namespace ${declaration.namespace}, with limit ${declaration.simple.limit} and period ${declaration.simple.period}. Namespace IDs share counters across Workers in the account; review existing usage before choosing or changing one.`;
  return {
    type: 'manual',
    key: fields.id,
    guide: {
      url: 'https://dash.cloudflare.com/',
      steps: [
        `Inspect ${manifest.cloudflare.worker} in the declared Cloudflare account and compare its deployed bindings with ${configPath}.`,
        requirement,
        'Review the repository configuration change and publish it through the saved staging and promotion workflow; setup does not rewrite deployed resource bindings.',
        'Run pnpm preflight --production again, then perform the documented runtime acceptance separately.',
      ],
    },
  };
}
function bindingItem(context, kind, declaration) {
  const { state, configPath } = context;
  const fields = {
    id: `${kind}:${declaration.binding}`,
    section: kind === 'analyticsEngine' ? 'Analytics Engine' : 'Rate limiting',
    label: declaration.binding,
  };
  if (!state.config.ok) return unknownItem(fields, state.config);
  const local = (state.config.value[kind] ?? []).filter(
    (entry) => entry.binding === declaration.binding,
  );
  const action = manualBindingAction(context, fields, kind, declaration);
  if (local.length !== 1 || !agrees(kind, local[0], declaration))
    return item({
      ...fields,
      status: 'mismatch',
      detail: `${configPath} does not uniquely declare the required binding and settings`,
      next: `review ${configPath}`,
      action,
    });
  if (!state.worker.ok) return unknownItem({ ...fields, credentialHint: TOKEN_HINT }, state.worker);
  const deployed = (state.worker.value[kind] ?? []).filter(
    (entry) => entry.binding === declaration.binding,
  );
  if (deployed.length !== 1 || !agrees(kind, deployed[0], declaration))
    return item({
      ...fields,
      status: deployed.length ? 'mismatch' : 'missing',
      detail: 'deployed Worker does not uniquely carry the declared resource binding and settings',
      next: `${SETUP} shows maintainer deployment steps`,
      action,
    });
  return item({
    ...fields,
    status: 'ok',
    detail:
      'repository and deployed Worker binding settings agree; event delivery is a separate runtime check',
  });
}
export function planWorkerBindings(context) {
  return ['analyticsEngine', 'rateLimits'].flatMap((kind) =>
    (context.manifest[kind] ?? []).map((declaration) => bindingItem(context, kind, declaration)),
  );
}
