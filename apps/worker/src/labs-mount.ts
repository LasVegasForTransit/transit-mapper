const LABS_HOSTNAME = 'labs.lasvegasfortransit.org';
const LABS_MOUNT_PATH = '/transit-mapper';

type AppFetch = (
  request: Request,
  env: Env,
  context: ExecutionContext,
) => Response | Promise<Response>;

export function isLabsMount(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.hostname === LABS_HOSTNAME &&
    (url.pathname === LABS_MOUNT_PATH || url.pathname.startsWith(`${LABS_MOUNT_PATH}/`))
  );
}

export function labsAssetPath(pathname: string): boolean {
  return !/^\/(?:api|s|e|v|embed)(?:\/|$)/.test(pathname);
}

function rewriteLabsPath(element: Element, attribute: 'href' | 'src'): void {
  const value = element.getAttribute(attribute);
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return;
  if (value === LABS_MOUNT_PATH || value.startsWith(`${LABS_MOUNT_PATH}/`)) return;
  element.setAttribute(attribute, `${LABS_MOUNT_PATH}${value}`);
}

export async function fetchLabsMount(
  request: Request,
  env: Env,
  context: ExecutionContext,
  appFetch: AppFetch,
): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(LABS_MOUNT_PATH.length) || '/';
  const mountedRequest = new Request(url, request);
  const response = labsAssetPath(url.pathname)
    ? await env.ASSETS.fetch(mountedRequest)
    : await appFetch(mountedRequest, env, context);
  if (!response.headers.get('content-type')?.includes('text/html')) return response;

  // The Vite build is rooted for the canonical map hostname. Only the Labs
  // response needs its HTML asset paths rewritten for the mounted route.
  return new HTMLRewriter()
    .on('[href]', { element: (element) => rewriteLabsPath(element, 'href') })
    .on('[src]', { element: (element) => rewriteLabsPath(element, 'src') })
    .transform(response);
}
