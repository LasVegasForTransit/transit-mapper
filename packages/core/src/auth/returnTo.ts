// Guards the post-sign-in redirect against being pointed at another site.
//
// The check is allow-list shaped on purpose: anything that isn't obviously a
// same-origin path becomes "/". A blocklist here would be a game of spotting
// every encoding of "//", and losing that game silently hands visitors to
// whoever crafted the link.

// Written with escapes so the character class survives copy-paste.
//
// no-control-regex exists to catch control characters written into a pattern
// by accident. Here they are the point: a redirect target containing one must
// be rejected, so the pattern has to match them.
// eslint-disable-next-line no-control-regex -- matching control characters is the point here
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (CONTROL_CHARACTERS.test(value)) return '/';
  if (!value.startsWith('/')) return '/';
  // "//host" and "/\\host" are both protocol-relative URLs to another origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
