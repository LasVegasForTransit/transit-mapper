/** Root inputs shared by every workspace task, including checks that read vendored rules. */
export const TURBO_GLOBAL_DEPENDENCIES = [
  '.lvbt/web-platform.json',
  '.lvbt/tooling.json',
  '.github/workflows/**',
];

export function parseTurboCache(source) {
  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new Error(
      'turbo.json must contain valid JSON before the shared cache policy can update it.',
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('turbo.json must contain an object.');
  if (
    config.globalDependencies !== undefined &&
    (!Array.isArray(config.globalDependencies) ||
      config.globalDependencies.some((entry) => typeof entry !== 'string'))
  )
    throw new Error('turbo.json globalDependencies must be an array of strings.');
  return config;
}

export function turboCacheProblem(source) {
  if (source === null || source === undefined)
    return 'turbo.json is missing; declare shared globalDependencies so tooling and workflow changes invalidate workspace checks.';
  try {
    const config = parseTurboCache(source);
    const missing = TURBO_GLOBAL_DEPENDENCIES.filter(
      (entry) => !config.globalDependencies?.includes(entry),
    );
    if (missing.length)
      return `turbo.json globalDependencies is missing ${missing.join(', ')}; run pnpm standards:update to add shared cache inputs while preserving product tasks.`;
  } catch (error) {
    return error.message;
  }
}

/** The migration warns for unpublished snapshots and 0.7; adopted 0.8+ releases enforce it. */
export function turboCacheRequired(release) {
  const version = /^v(\d+)\.(\d+)\./u.exec(release ?? '');
  return Boolean(version && (Number(version[1]) > 0 || Number(version[2]) >= 8));
}
