import { describe, expect, it } from 'vitest';
import {
  databaseId,
  databaseName,
  extractCreatedId,
  withDatabaseId,
  PLACEHOLDER_DB_ID,
} from '../bootstrap/lib/wrangler-config.js';

/**
 * Provisioning writes a real database id into wrangler.toml. Sending that
 * write to the wrong block would point the production Worker at a throwaway
 * preview database, which nothing downstream would notice until it served
 * somebody an empty share.
 */

/** Both ids are the placeholder, as they are on a fresh clone. */
const FRESH = `name = "transitmapper"

[[d1_databases]]
binding = "DB"
database_name = "transitmapper"
database_id = "${PLACEHOLDER_DB_ID}"

[env.preview]
routes = []

[[env.preview.d1_databases]]
binding = "DB"
database_name = "transitmapper-preview"
database_id = "${PLACEHOLDER_DB_ID}"
`;

const CREATED = '5516498a-4473-468e-a1c9-a9dee4762960';

describe('reading wrangler.toml', () => {
  it('reads each environment through the parser, not through block order', () => {
    // The preview block below the production one, which is how the file is
    // written — and the reverse, which is equally valid TOML.
    const reversed = [
      FRESH.slice(FRESH.indexOf('[env.preview]')),
      FRESH.slice(0, FRESH.indexOf('[env.preview]')),
    ].join('\n');
    for (const toml of [FRESH, reversed]) {
      expect(databaseName(toml, 'production')).toBe('transitmapper');
      expect(databaseName(toml, 'preview')).toBe('transitmapper-preview');
    }
  });

  it('reports a placeholder id as no id at all', () => {
    expect(databaseId(FRESH, 'production')).toBeNull();
    expect(databaseId(FRESH, 'preview')).toBeNull();
  });

  it('reads the id wrangler prints when it creates a database', () => {
    expect(extractCreatedId(`database_id = "${CREATED}"`)).toBe(CREATED);
  });
});

describe('writing a database id', () => {
  it('writes the production id without touching the identical preview placeholder', () => {
    const next = withDatabaseId(FRESH, 'production', CREATED);
    expect(databaseId(next, 'production')).toBe(CREATED);
    expect(databaseId(next, 'preview')).toBeNull();
  });

  it('writes the preview id without touching production', () => {
    const next = withDatabaseId(FRESH, 'preview', CREATED);
    expect(databaseId(next, 'preview')).toBe(CREATED);
    expect(databaseId(next, 'production')).toBeNull();
  });

  it('keeps the comments that explain why each block is there', () => {
    const commented = FRESH.replace(
      '[[env.preview.d1_databases]]',
      '# One shared preview database.\n[[env.preview.d1_databases]]',
    );
    expect(withDatabaseId(commented, 'preview', CREATED)).toContain(
      '# One shared preview database.',
    );
  });

  it('refuses an environment that declares no database', () => {
    expect(() => withDatabaseId('name = "transitmapper"\n', 'preview', CREATED)).toThrow(
      /no preview d1_databases block/iu,
    );
  });
});
