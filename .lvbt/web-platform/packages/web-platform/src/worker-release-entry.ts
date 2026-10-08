import { z } from 'zod';
import { releaseMarkerPath } from './release-path.js';
import type { ReleaseConfiguration } from './release-config.js';
import type { SavedReleaseIdentity } from './saved-release-artifact.js';
export function configuredReleaseIdentity(
  identity: SavedReleaseIdentity,
  config: ReleaseConfiguration,
): SavedReleaseIdentity {
  if (identity.app && identity.app !== config.profile)
    throw new Error('Release identity belongs to another app.');
  return { ...identity, ...(config.profile ? { app: config.profile } : {}) };
}
export function workerReleaseEntry(
  main: string,
  identity: SavedReleaseIdentity,
  config: Pick<ReleaseConfiguration, 'publicPath' | 'previewReadOnlyBindings'> & {
    durableExports?: string[];
  },
): string {
  const module = JSON.stringify(main);
  const names = (config.durableExports ?? []).map((name) =>
    z
      .string()
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      .parse(name),
  );
  const constructors = names
    .map(
      (name) =>
        `export class ${name} extends original.${name} { constructor(ctx,env) { super(ctx,previewEnvironment(env)); } }`,
    )
    .join('\n');
  return `import application from ${module};\nimport * as original from ${module};\nexport * from ${module};
const identity=${JSON.stringify(identity)};
const markerPaths=${JSON.stringify(['/lvbt-release.json', releaseMarkerPath(config.publicPath)])};
const readonlyBindings=${JSON.stringify(config.previewReadOnlyBindings ?? [])};
function previewEnvironment(env) {
  if (env.LVBT_DEPLOYMENT_ENV !== 'preview') return env;
  const detached=Object.create(null);
  for (const name of Reflect.ownKeys(env)) {
    const value=Reflect.get(env,name);
    let binding=value;
    if (readonlyBindings.includes(name)) {
      const facade=Object.create(null);
      for (const method of ['get','head','list']) if (typeof value[method]==='function')
        Object.defineProperty(facade,method,{value:value[method].bind(value),enumerable:true});
      binding=new Proxy(Object.freeze(facade),{get(bucket,method){
      if (!['get','head','list'].includes(method)) throw new Error('Preview binding '+name+' is read-only.');
      return Reflect.get(bucket,method);
      }});
    }
    Object.defineProperty(detached,name,{value:binding,enumerable:true});
  }
  return Object.freeze(detached);
}
${constructors}
export default new Proxy(application,{get(target,name){
  if (name !== 'fetch') {
    const value=Reflect.get(target,name);
    return typeof value==='function' ? (...args)=>{args[1]=previewEnvironment(args[1]);return value.apply(target,args)} : value;
  }
  return async (request,env,ctx)=>{
    let response;
    if (markerPaths.includes(new URL(request.url).pathname)) response=Response.json(identity,{headers:{'Cache-Control':'no-store'}});
    else response=await target.fetch(request,previewEnvironment(env),ctx);
    if (env.LVBT_DEPLOYMENT_ENV !== 'preview') return response;
    const headers=new Headers(response.headers);
    headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
    headers.set('Cache-Control','private, no-store');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
}});\n`;
}
