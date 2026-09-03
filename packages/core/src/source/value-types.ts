export interface PublisherRef {
  id: string;
  name: string;
  url?: string;
}

export interface Attribution {
  text: string;
  url?: string;
}

export interface LicenseRef {
  id: string;
  name: string;
  url?: string;
}

export type IdentityStability = 'source-stable' | 'revision-local';

export interface ContentDigest {
  algorithm: 'sha-256';
  value: string;
}

export interface ArtifactDescriptor {
  digest: ContentDigest;
  mediaType: string;
  byteLength: number;
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const mediaTypePattern =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+(?:\s*;\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=(?:[!#$%&'*+\-.^_`|~0-9A-Za-z]+|"(?:[^"\\\r\n]|\\[\t\x20-\x7e])*"))*$/;

function valueRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value;
}

function optionalHttpUrl(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const text = requiredText(value, label);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  return text;
}

export function parsePublisherRef(value: unknown): PublisherRef {
  const record = valueRecord(value, 'Publisher reference');
  const publisher: PublisherRef = {
    id: requiredText(record.id, 'Publisher ID'),
    name: requiredText(record.name, 'Publisher name'),
  };
  const url = optionalHttpUrl(record.url, 'Publisher URL');
  if (url !== undefined) publisher.url = url;
  return publisher;
}

export function parseAttribution(value: unknown): Attribution {
  const record = valueRecord(value, 'Attribution');
  const attribution: Attribution = {
    text: requiredText(record.text, 'Attribution text'),
  };
  const url = optionalHttpUrl(record.url, 'Attribution URL');
  if (url !== undefined) attribution.url = url;
  return attribution;
}

export function parseLicenseRef(value: unknown): LicenseRef {
  const record = valueRecord(value, 'License reference');
  const license: LicenseRef = {
    id: requiredText(record.id, 'License ID'),
    name: requiredText(record.name, 'License name'),
  };
  const url = optionalHttpUrl(record.url, 'License URL');
  if (url !== undefined) license.url = url;
  return license;
}

export function parseContentDigest(value: unknown): ContentDigest {
  const record = valueRecord(value, 'Content digest');
  if (record.algorithm !== 'sha-256') {
    throw new Error('Content digest algorithm must be sha-256.');
  }
  const digestValue = requiredText(record.value, 'Content digest value');
  if (!sha256Pattern.test(digestValue)) {
    throw new Error('Content digest value must be 64 lowercase hexadecimal digits.');
  }
  return { algorithm: 'sha-256', value: digestValue };
}

export function parseArtifactDescriptor(value: unknown): ArtifactDescriptor {
  const record = valueRecord(value, 'Artifact descriptor');
  const mediaType = requiredText(record.mediaType, 'Artifact media type');
  if (!mediaTypePattern.test(mediaType)) {
    throw new Error('Artifact media type is invalid.');
  }
  if (
    typeof record.byteLength !== 'number' ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength < 0
  ) {
    throw new Error('Artifact byte length must be a nonnegative safe integer.');
  }
  return {
    digest: parseContentDigest(record.digest),
    mediaType,
    byteLength: record.byteLength,
  };
}
