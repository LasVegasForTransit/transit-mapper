/** The generated evidence follows report content; earlier quoted run identifiers are not its owner. */
export function latestIssueEvidence(body) {
  if (typeof body !== 'string') return undefined;
  return [...body.matchAll(/^Verified run: (\d+) \(attempt (\d+)\)\.$/gm)].at(-1);
}
