/** One declaration may share a value within its targets; other declarations stay independent. */
export function secretTargets(secret) {
  return secret.targets ?? ['worker'];
}
export function secretForTarget(manifest, name, target) {
  return manifest.secrets?.find(
    (secret) => secret.name === name && secretTargets(secret).includes(target),
  );
}
export function secretValueKey(manifest, secret) {
  const repeated =
    (manifest.secrets ?? []).filter((entry) => entry.name === secret.name).length > 1;
  return repeated
    ? `${secret.name}:${JSON.stringify([...secretTargets(secret)].sort())}`
    : secret.name;
}
export function scopedSecretErrors(secrets = []) {
  const seen = new Map();
  const errors = [];
  for (const secret of secrets) {
    const targets = secretTargets(secret);
    if (new Set(targets).size !== targets.length)
      errors.push(`${secret.name} repeats a target in its declaration.`);
    const prior = seen.get(secret.name) ?? [];
    if (
      prior.some(
        (other) =>
          !secret.targets ||
          !other.targets ||
          targets.some((target) => other.targets.includes(target)),
      )
    )
      errors.push(
        `${secret.name} is declared more than once with overlapping or implicit target scopes.`,
      );
    seen.set(secret.name, [...prior, secret]);
  }
  return errors;
}
