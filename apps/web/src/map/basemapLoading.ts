export interface RemoteBasemapLoadInput {
  documentReady: boolean;
  remoteBasemapRequested: boolean;
}

/**
 * The placeholder document exists only while storage resolves the real one.
 * Loading a remote map beneath it fetches tiles for a camera nobody will see.
 */
export function shouldRequestRemoteBasemap(input: RemoteBasemapLoadInput): boolean {
  return input.documentReady && !input.remoteBasemapRequested;
}
