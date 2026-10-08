/** Public resource declarations only; secret values never enter the binding inventory. */
function inventory(analyticsEngine, rateLimits) {
  return {
    ...(analyticsEngine.length ? { analyticsEngine } : {}),
    ...(rateLimits.length ? { rateLimits } : {}),
  };
}
const dataset = (binding, name) => ({ binding, name });
const limiter = (binding, namespace, simple) => ({ binding, namespace: String(namespace), simple });

export function wranglerWorkerBindings(config) {
  const analyticsEngine = (config.analytics_engine_datasets ?? []).map((entry) =>
    dataset(entry.binding, entry.dataset),
  );
  const rateLimits = [
    ...(config.ratelimits ?? []),
    ...(config.unsafe?.bindings ?? []).filter((entry) => entry.type === 'ratelimit'),
  ].map((entry) => limiter(entry.name, entry.namespace_id, entry.simple));
  return inventory(analyticsEngine, rateLimits);
}

export function cloudflareWorkerBindings(env) {
  const analyticsEngine = [];
  const rateLimits = [];
  for (const [binding, entry] of Object.entries(env)) {
    if (entry.type === 'analytics-engine-dataset')
      analyticsEngine.push(dataset(binding, entry.name));
    if (entry.type === 'rate-limit')
      rateLimits.push(limiter(binding, entry.namespace, entry.simple));
  }
  return inventory(analyticsEngine, rateLimits);
}

export function deployedWorkerBindings(bindings) {
  const analyticsEngine = bindings
    .filter((entry) => entry.type === 'analytics_engine')
    .map((entry) => dataset(entry.name, entry.dataset));
  const rateLimits = bindings
    .filter((entry) => entry.type === 'ratelimit')
    .map((entry) => limiter(entry.name, entry.namespace_id, entry.simple));
  return inventory(analyticsEngine, rateLimits);
}
