/** Public snapshots and embeds are delivery surfaces, not installed editors.
 * Registering the editor worker there would download its offline graph without
 * user intent and let a third-party iframe claim the host origin's scope. */
export function serviceWorkerRegistrationEnabled(pathname: string): boolean {
  return !/^\/(?:s|e)(?:\/|$)/.test(pathname);
}
