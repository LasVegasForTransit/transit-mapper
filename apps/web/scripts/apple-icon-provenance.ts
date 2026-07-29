import { createHash } from 'node:crypto';

const PROVENANCE_VERSION = 1;
const SHA_256_PATTERN = /^[\da-f]{64}$/;

export interface AppleIconProvenanceInputs {
  iconDocument: Uint8Array;
  layer: Uint8Array;
  exportImage: Uint8Array;
}

export interface AppleIconProvenance {
  version: typeof PROVENANCE_VERSION;
  iconDocumentSha256: string;
  layerSha256: string;
  exportImageSha256: string;
}

function sha256(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

export function createAppleIconProvenance(inputs: AppleIconProvenanceInputs): AppleIconProvenance {
  return {
    version: PROVENANCE_VERSION,
    iconDocumentSha256: sha256(inputs.iconDocument),
    layerSha256: sha256(inputs.layer),
    exportImageSha256: sha256(inputs.exportImage),
  };
}

export function appleIconProvenanceMatches(
  provenance: AppleIconProvenance,
  inputs: AppleIconProvenanceInputs,
): boolean {
  const current = createAppleIconProvenance(inputs);
  return (
    provenance.version === current.version &&
    provenance.iconDocumentSha256 === current.iconDocumentSha256 &&
    provenance.layerSha256 === current.layerSha256 &&
    provenance.exportImageSha256 === current.exportImageSha256
  );
}

export function parseAppleIconProvenance(serialized: string): AppleIconProvenance | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== PROVENANCE_VERSION ||
      !('iconDocumentSha256' in value) ||
      typeof value.iconDocumentSha256 !== 'string' ||
      !SHA_256_PATTERN.test(value.iconDocumentSha256) ||
      !('layerSha256' in value) ||
      typeof value.layerSha256 !== 'string' ||
      !SHA_256_PATTERN.test(value.layerSha256) ||
      !('exportImageSha256' in value) ||
      typeof value.exportImageSha256 !== 'string' ||
      !SHA_256_PATTERN.test(value.exportImageSha256)
    ) {
      return null;
    }

    return {
      version: PROVENANCE_VERSION,
      iconDocumentSha256: value.iconDocumentSha256,
      layerSha256: value.layerSha256,
      exportImageSha256: value.exportImageSha256,
    };
  } catch {
    return null;
  }
}

export function serializeAppleIconProvenance(provenance: AppleIconProvenance): string {
  return `${JSON.stringify(provenance, null, 2)}\n`;
}
