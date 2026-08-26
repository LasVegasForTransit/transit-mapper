import type { MapViewStateV1 } from './contract';
import { parseMapViewState, parseMapViewStateJson, ViewParseError } from './parse';

export const MAX_TRANSIENT_VIEW_FRAGMENT_BYTES = 8 * 1024;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Bytes(value: string): number[] {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] !== '%') {
      bytes.push(encoded.charCodeAt(index));
      continue;
    }
    bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
    index += 2;
  }
  return bytes;
}

function base64UrlEncode(value: string): string {
  const bytes = utf8Bytes(value);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes.at(index + 1);
    const third = bytes.at(index + 2);
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(block >>> 18) & 63];
    output += BASE64_ALPHABET[(block >>> 12) & 63];
    if (second !== undefined) output += BASE64_ALPHABET[(block >>> 6) & 63];
    if (third !== undefined) output += BASE64_ALPHABET[block & 63];
  }
  return output.replaceAll('+', '-').replaceAll('/', '_');
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new ViewParseError('Transient View fragment must contain valid base64url');
  }
  const input = value.replaceAll('-', '+').replaceAll('_', '/');
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 4) {
    const remaining = input.length - index;
    const first = BASE64_ALPHABET.indexOf(input[index]);
    const second = BASE64_ALPHABET.indexOf(input[index + 1]);
    const third = remaining > 2 ? BASE64_ALPHABET.indexOf(input[index + 2]) : 0;
    const fourth = remaining > 3 ? BASE64_ALPHABET.indexOf(input[index + 3]) : 0;
    const block = (first << 18) | (second << 12) | (third << 6) | fourth;
    bytes.push((block >>> 16) & 255);
    if (remaining > 2) bytes.push((block >>> 8) & 255);
    if (remaining > 3) bytes.push(block & 255);
  }
  try {
    return decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''),
    );
  } catch {
    throw new ViewParseError('Transient View fragment must contain UTF-8 JSON');
  }
}

function decodedFragment(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ViewParseError('Transient View fragment must be URL encoded');
  }
  if (utf8Bytes(decoded).length > MAX_TRANSIENT_VIEW_FRAGMENT_BYTES) {
    throw new ViewParseError('Transient View fragment may contain at most 8 KiB');
  }
  return decoded;
}

export function encodeMapViewState(state: MapViewStateV1): string {
  const encoded = base64UrlEncode(JSON.stringify(parseMapViewState(state)));
  if (encoded.length > MAX_TRANSIENT_VIEW_FRAGMENT_BYTES) {
    throw new ViewParseError('Transient View fragment may contain at most 8 KiB');
  }
  return encoded;
}

export function decodeMapViewState(fragmentValue: string): MapViewStateV1 {
  return parseMapViewStateJson(base64UrlDecode(decodedFragment(fragmentValue)));
}
