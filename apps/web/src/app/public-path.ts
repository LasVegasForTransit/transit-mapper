const LABS_HOSTNAME = 'labs.lasvegasfortransit.org';
const LABS_MOUNT_PATH = '/transit-mapper';

interface BrowserLocation {
  hostname: string;
  pathname: string;
  origin?: string;
}

function currentLocation(): BrowserLocation | undefined {
  return globalThis.location;
}

/** The Labs alias is mounted below its hostname; the canonical map hostname
 * stays rooted. Keeping this decision in one place prevents share, API, and
 * browser navigation paths from silently splitting between the two origins. */
export function publicBasePath(location = currentLocation()): string {
  if (
    location?.hostname === LABS_HOSTNAME &&
    (location.pathname === LABS_MOUNT_PATH || location.pathname.startsWith(`${LABS_MOUNT_PATH}/`))
  ) {
    return LABS_MOUNT_PATH;
  }
  return '';
}

export function publicPath(path: string, location = currentLocation()): string {
  if (!path.startsWith('/')) throw new Error('Public paths must start with a slash.');
  return `${publicBasePath(location)}${path}`;
}

export function publicUrl(path: string, location = currentLocation()): string {
  if (location === undefined) throw new Error('A browser location is required for a public URL.');
  return new URL(
    publicPath(path, location),
    location.origin ?? `https://${location.hostname}`,
  ).toString();
}

export function appRoutePath(pathname: string, location = currentLocation()): string {
  const base = publicBasePath(location);
  if (!base) return pathname;
  return pathname === base ? '/' : pathname.slice(base.length) || '/';
}
