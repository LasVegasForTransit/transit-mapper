/**
 * The `--site` argument every deployed-origin check takes.
 *
 * Shared because the two checks run back to back against the same value in
 * both deploy workflows: the HTTP smoke and then the browser walkthrough. Two
 * copies of this parser would let them disagree about what they were pointed
 * at, and the disagreement would show up as one of them silently checking the
 * wrong origin.
 */
export function siteFromArgs(args: readonly string[]): string {
  const index = args.indexOf('--site');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error('--site requires the deployed application URL.');
  const site = new URL(value);
  if (site.protocol !== 'https:' && site.protocol !== 'http:') {
    throw new Error('--site must use HTTP or HTTPS.');
  }
  return site.href.replace(/\/$/u, '');
}
