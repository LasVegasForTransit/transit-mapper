import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  MAX_SHARE_BODY_BYTES,
  serializeShareRequest,
  serializeShareRequestFromData,
  shareRequestFits,
  type SerializedShareRequest,
} from '@transitmapper/core/share/contract';

export class ShareTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super(
      `This system is ${(byteLength / 1_000_000).toFixed(1)} MB, larger than the 1 MB sharing limit. Export it as JSON instead.`,
    );
    this.name = 'ShareTooLargeError';
  }
}

export interface PrepareSharePayloadOptions {
  /** Best-effort social preview, already encoded for the JSON wire format. */
  renderPreview: () => Promise<string | null | undefined>;
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The operation was canceled.', 'AbortError');
}

/** Build a publish request with the expensive work in UX order: serialize once,
 * enforce the hard server contract, then attempt the optional preview. A card
 * that would push an otherwise valid document over the limit is omitted. */
export async function prepareSharePayload(
  system: TransitSystem,
  options: PrepareSharePayloadOptions,
): Promise<SerializedShareRequest> {
  return addPreviewToSharePayload(serializeShareRequest(system), options);
}

/** Complete a request whose system JSON is already needed for local
 * change-detection, preserving that single traversal for the network body. */
export async function addPreviewToSharePayload(
  request: SerializedShareRequest,
  options: PrepareSharePayloadOptions,
): Promise<SerializedShareRequest> {
  if (!shareRequestFits(request)) throw new ShareTooLargeError(request.byteLength);
  throwIfAborted(options.signal);

  const preview = await options.renderPreview();
  throwIfAborted(options.signal);
  if (!preview) return request;

  const withPreview = serializeShareRequestFromData(request.data, preview);
  return withPreview.byteLength <= MAX_SHARE_BODY_BYTES ? withPreview : request;
}
