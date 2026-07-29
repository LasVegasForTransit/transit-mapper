// Deterministic verification of the Worker's request-handling logic, without
// a network, a database or a Workers runtime.
//
// The Worker had no `verify` script at all, which per AGENTS.md means turbo
// skipped it silently and CI stayed green — so every security-relevant
// decision in apps/worker/src/index.ts was typechecked and never once
// executed by a test. That is the wrong half to leave uncovered: this file is
// the only code in the project that reads bytes from strangers.
//
// Same shape as apps/web/tests/verify.ts on purpose: no framework, one
// `check()` per rule, the name *is* the failure message.
//
// Run with: pnpm --filter @transitmapper/worker verify
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '@transitmapper/core/render/preview';
import { MAX_PREVIEW_BYTES } from '@transitmapper/core/render/pngBytes';
import {
  acceptedPreview,
  escapeHtmlAttribute,
  positiveInt,
  shareIdFromUrl,
  SHARE_ID_PATTERN,
} from '../src/index';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(cond ? `  ok  ${name}` : `FAIL  ${name}`);
  if (!cond) failures++;
}

const SITE = 'https://map.lasvegasfortransit.org';

// --- share id shape: what reaches a database query ---
{
  check('a shortId-shaped id is accepted', SHARE_ID_PATTERN.test('a1b2c3d4e5'));
  check(
    'an uppercase id is rejected — shortId never produces one',
    !SHARE_ID_PATTERN.test('A1B2C3'),
  );
  check('an empty id is rejected', !SHARE_ID_PATTERN.test(''));
  check('a path traversal attempt is rejected', !SHARE_ID_PATTERN.test('../../etc/passwd'));
  check('a quoted SQL fragment is rejected', !SHARE_ID_PATTERN.test("' OR 1=1--"));
  check('an over-long id is rejected', !SHARE_ID_PATTERN.test('a'.repeat(33)));
  check('an id at the length limit is accepted', SHARE_ID_PATTERN.test('a'.repeat(32)));
}

// --- oEmbed target scoping: the check that keeps this from describing the
//     whole internet under our provider name ---
{
  check(
    'a share URL on our origin yields its id',
    shareIdFromUrl(`${SITE}/s/abc123`, SITE) === 'abc123',
  );
  check(
    'an embed URL on our origin yields its id',
    shareIdFromUrl(`${SITE}/e/abc123`, SITE) === 'abc123',
  );
  check('a trailing slash is tolerated', shareIdFromUrl(`${SITE}/s/abc123/`, SITE) === 'abc123');
  check(
    'another origin is refused',
    shareIdFromUrl('https://evil.example/s/abc123', SITE) === null,
  );
  check(
    'a lookalike host is refused',
    shareIdFromUrl('https://map.lasvegasfortransit.org.evil.example/s/abc123', SITE) === null,
  );
  check(
    'http against our https origin is refused',
    shareIdFromUrl('http://map.lasvegasfortransit.org/s/abc123', SITE) === null,
  );
  check(
    'a non-share path on our origin is refused',
    shareIdFromUrl(`${SITE}/about`, SITE) === null,
  );
  check(
    'a nested path under /s/ is refused',
    shareIdFromUrl(`${SITE}/s/abc123/extra`, SITE) === null,
  );
  check(
    'a malformed URL is refused rather than thrown',
    shareIdFromUrl('not a url', SITE) === null,
  );
  check(
    'an id that fails the pattern is refused even on our origin',
    shareIdFromUrl(`${SITE}/s/ABC!`, SITE) === null,
  );
  check('a javascript: URL is refused', shareIdFromUrl('javascript:alert(1)', SITE) === null);
}

// --- oEmbed consumer hints ---
{
  check('a positive integer is read', positiveInt('640') === 640);
  check('a missing value is null', positiveInt(undefined) === null);
  check('an empty string is null', positiveInt('') === null);
  check('zero is refused — it is not a usable width', positiveInt('0') === null);
  check('a negative is refused', positiveInt('-5') === null);
  check('a fraction is refused', positiveInt('1.5') === null);
  check('text is refused', positiveInt('wide') === null);
}

// --- oEmbed html escaping: the one place a system name lands in raw markup ---
{
  check(
    'a quote cannot close the attribute',
    !escapeHtmlAttribute('" onload="alert(1)').includes('"'),
  );
  check('a tag cannot be opened', escapeHtmlAttribute('<script>') === '&lt;script&gt;');
  check(
    'an ampersand is escaped first, so entities are not double-broken',
    escapeHtmlAttribute('&lt;') === '&amp;lt;',
  );
  check('a single quote is escaped too', escapeHtmlAttribute("it's") === 'it&#39;s');
  check(
    'ordinary text is left alone',
    escapeHtmlAttribute('Las Vegas Line 1') === 'Las Vegas Line 1',
  );
}

// --- uploaded preview cards: bytes from a browser we do not control ---
{
  // Build a PNG by hand. checkPreviewPng deliberately does not verify CRCs
  // (it walks chunk sizes only), so these can be zero.
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    ...u32(0), // CRC placeholder — not checked
  ];
  const png = (w: number, h: number, trailing: number[] = []) =>
    new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]),
      ...chunk('IEND', []),
      ...trailing,
    ]);
  const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

  const card = png(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  check(
    'a well-formed card of exactly card size is accepted',
    acceptedPreview(toBase64(card)) !== null,
  );
  check(
    'an accepted card round-trips its bytes intact',
    acceptedPreview(toBase64(card))?.length === card.length,
  );

  check('a card of the wrong size is dropped', acceptedPreview(toBase64(png(100, 100))) === null);
  check(
    'a missing preview is dropped rather than failing the share',
    acceptedPreview(undefined) === null,
  );
  check('a non-string preview is dropped', acceptedPreview({ nice: 'try' }) === null);
  check('an empty string is dropped', acceptedPreview('') === null);
  check(
    'bytes that are not a PNG are dropped',
    acceptedPreview(toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))) === null,
  );
  check(
    'invalid base64 is dropped rather than thrown',
    acceptedPreview('!!!!not base64!!!!') === null,
  );

  // The polyglot case: a valid PNG with markup appended. Response headers
  // already defang these, but storing one at all is worse than not.
  const polyglot = png(
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    [...'<script>alert(1)</script>'].map((c) => c.charCodeAt(0)),
  );
  check(
    'a PNG with content appended after IEND is dropped',
    acceptedPreview(toBase64(polyglot)) === null,
  );

  // Oversize is refused on the encoded string, before anything is allocated.
  check(
    'an oversize payload is refused without being decoded',
    acceptedPreview('A'.repeat(MAX_PREVIEW_BYTES * 2)) === null,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
