export function ownershipLabel(name) {
  const value = name.toLowerCase();
  return value.endsWith('-owned') || /^(audit|recurring|target):/.test(value);
}
export function foreignOwnership(labels, allowed) {
  return labels.some(({ name }) => ownershipLabel(name) && !allowed.includes(name.toLowerCase()));
}
