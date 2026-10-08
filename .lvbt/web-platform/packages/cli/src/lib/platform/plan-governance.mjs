import { item } from './plan-items.mjs';
export function planGovernance({ manifest, state }) {
  if (!manifest.github?.governance) return [];
  const observation = state.governance;
  const fields = { section: 'GitHub governance', level: 'recommended' };
  if (!observation?.ok)
    return [
      item({
        ...fields,
        id: 'github:governance',
        label: 'Organization governance',
        status: 'unknown',
        detail: observation?.reason ?? 'No governance inventory was produced.',
        next: 'Install the shared release and run pnpm preflight --production with GitHub read permissions.',
      }),
    ];
  return observation.value.map((check) =>
    item({
      ...fields,
      id: `github:${check.id}`,
      label: check.id,
      status: check.status === 'pass' ? 'ok' : check.status === 'fail' ? 'mismatch' : 'unknown',
      detail: check.requirement,
      next:
        check.status === 'unknown'
          ? 'Check GitHub read permissions and rerun preflight.'
          : check.requirement,
    }),
  );
}
