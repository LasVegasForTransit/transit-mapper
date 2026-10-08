/** Select only the named deployment's binding inventory; never fall back to production. */
export function configForEnvironment(config, environment) {
  if (!environment || !config?.ok) return config;
  return (
    config.value?.environments?.[environment] ?? {
      ok: false,
      reason: `cannot read deployment environment ${environment}`,
      kind: 'error',
    }
  );
}
