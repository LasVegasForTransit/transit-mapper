import { frame } from '../encoding/frame';
import { semanticDigest, sha256Digest } from '../encoding/semantic-digest';
import { parseContentDigest, type ContentDigest } from '../source/value-types';
import type { TransitSystem } from '../transit/authored-system';
import { parseAuthoredSystem } from './schema-v17-system/parse-authored-system';
import { parseInstant, parseText } from './schema-v17-system/parse-values';

export interface SystemRevision {
  id: string;
  systemId: string;
  createdAt: string;
  schemaVersion: 17;
  contentDigest: ContentDigest;
  system: TransitSystem;
}

export interface CreateSystemRevisionInput {
  systemId: string;
  createdAt: string;
  system: unknown;
}

function contentDigestForParsedSystem(system: TransitSystem): Promise<ContentDigest> {
  return semanticDigest({
    encodingVersion: 'transit-system-json-v1',
    schemaVersion: 17,
    system,
  });
}

export async function systemRevisionContentDigest(system: unknown): Promise<ContentDigest> {
  return contentDigestForParsedSystem(parseAuthoredSystem(system));
}

export async function systemRevisionId(
  systemId: string,
  contentDigest: ContentDigest,
): Promise<string> {
  const parsedSystemId = parseText(systemId, 'System ID');
  const parsedDigest = parseContentDigest(contentDigest);
  const digest = await sha256Digest(
    frame(['system-revision-v1', parsedSystemId, parsedDigest.algorithm, parsedDigest.value]),
  );
  return digest.value;
}

/** Creates deterministic revision content. Storage owns duplicate insertion and
 * keeps the first creation timestamp for an existing revision ID. */
export async function createSystemRevision(
  input: CreateSystemRevisionInput,
): Promise<SystemRevision> {
  const systemId = parseText(input.systemId, 'System ID');
  const createdAt = parseInstant(input.createdAt, 'System revision creation timestamp');
  const system = parseAuthoredSystem(input.system);
  const contentDigest = await contentDigestForParsedSystem(system);
  return {
    id: await systemRevisionId(systemId, contentDigest),
    systemId,
    createdAt,
    schemaVersion: 17,
    contentDigest,
    system,
  };
}
