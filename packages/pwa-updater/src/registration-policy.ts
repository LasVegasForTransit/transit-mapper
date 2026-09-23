/** Public snapshots, embeds, and the Labs alias are delivery surfaces, not installed editors.
 * Registering the editor worker there would download its offline graph without
 * user intent and let a third-party iframe claim the host origin's scope. */
export function serviceWorkerRegistrationEnabled(pathname: string): boolean {
  return (
    pathname !== '/transit-mapper' &&
    !pathname.startsWith('/transit-mapper/') &&
    !/^\/(?:s|e)(?:\/|$)/.test(pathname)
  );
}
