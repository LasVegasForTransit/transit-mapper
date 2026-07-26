// Decides what the browser keeps after trying to claim the anonymous shares
// it created. Kept pure so `pnpm verify` can cover it: getting this wrong
// either loses a claimable share forever or retries a hopeless one on every
// single page load.

export interface HeldShare {
  id: string;
  claimToken: string;
}

export interface ClaimResult {
  id: string;
  status: number;
}

export type ClaimOutcome = "claimed" | "rejected" | "retry";

export function claimOutcome(status: number): ClaimOutcome {
  if (status === 200) return "claimed";
  // 403 wrong or spent token, 409 already owned, 404 share is gone. None of
  // these change on a retry, so the local entry is dead weight.
  if (status === 403 || status === 409 || status === 404) return "rejected";
  return "retry";
}

/** Held shares minus the ones that reached a final state. Order preserved.
 *
 *  Generic in the entry type, not fixed to HeldShare: the browser stores a
 *  wider record than the claim request sends, and a caller passing the wider
 *  type must get the wider type back rather than a silently narrowed one. */
export function retainedShares<T extends HeldShare>(held: T[], results: ClaimResult[]): T[] {
  const settled = new Set(
    results.filter((r) => claimOutcome(r.status) !== "retry").map((r) => r.id),
  );
  return held.filter((share) => !settled.has(share.id));
}
