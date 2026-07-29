import { gzipSync } from 'node:zlib';

export interface EncodedJsonResponses {
  identity: Buffer;
  gzip: Buffer;
}

export interface SelectedJsonResponse {
  body: Buffer;
  headers: Record<string, string>;
}

interface AcceptedEncoding {
  name: string;
  quality: number;
}

function acceptedEncodings(header: string): AcceptedEncoding[] {
  return header.split(',').map((entry) => {
    const [rawName, ...parameters] = entry.split(';');
    const qualityParameter = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.toLowerCase().startsWith('q='));
    const parsedQuality = qualityParameter ? Number.parseFloat(qualityParameter.slice(2)) : 1;
    return {
      name: rawName.trim().toLowerCase(),
      quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
    };
  });
}

function acceptsGzip(header: string | null): boolean {
  if (!header) return false;
  const encodings = acceptedEncodings(header);
  const explicit = encodings.find((encoding) => encoding.name === 'gzip');
  if (explicit) return explicit.quality > 0;
  return (encodings.find((encoding) => encoding.name === '*')?.quality ?? 0) > 0;
}

/** Precompute both representations before tracing starts. The routed response
 * then models ordinary HTTP content negotiation without charging Node's gzip
 * work to browser startup or changing what the browser ultimately parses. */
export function createEncodedJsonResponses(json: string): EncodedJsonResponses {
  const identity = Buffer.from(json, 'utf8');
  return { identity, gzip: gzipSync(identity) };
}

export function selectEncodedJsonResponse(
  responses: EncodedJsonResponses,
  acceptEncoding: string | null,
): SelectedJsonResponse {
  const gzip = acceptsGzip(acceptEncoding);
  const body = gzip ? responses.gzip : responses.identity;
  return {
    body,
    headers: {
      'cache-control': 'no-store',
      'content-length': String(body.byteLength),
      'content-type': 'application/json',
      vary: 'accept-encoding',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    },
  };
}
