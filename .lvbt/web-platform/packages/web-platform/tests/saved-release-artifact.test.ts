import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { packageRelease, verifyRelease, sealSavedRelease } from '../src/saved-release-artifact.js';

const identity = { commit: 'a'.repeat(40), releaseId: '12345' };

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-test-'));
  const source = path.join(root, 'source');
  const release = path.join(root, 'release');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await mkdir(path.join(source, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(source, 'dist/index.html'), '<h1>Arts District</h1>');
  await writeFile(path.join(source, '.wrangler/worker/index.js'), 'export default {}');
  await writeFile(path.join(source, 'wrangler.jsonc'), '{"name":"lvbt-website"}');
  return { root, source, release };
}

test('a release retains reviewed files and identity after its source changes', async () => {
  const f = await fixture();
  try {
    const release = await packageRelease(f.source, f.release, identity);
    await writeFile(path.join(f.source, 'dist/index.html'), '<h1>Newer build</h1>');
    assert.deepEqual(await verifyRelease(f.release), release);
    assert.equal(
      await readFile(path.join(f.release, 'dist/index.html'), 'utf8'),
      '<h1>Arts District</h1>',
    );
    assert.equal(release.releaseId, '12345');
    // Produced by the pre-migration website reader from this exact fixture.
    assert.equal(
      release.artifactHash,
      '10d105e6fcdba40eb3559b7368b670102e0d260fab70ed17e9e8bc88f9fa178a',
    );
    assert.equal(
      release.files.some(([name]) => name === '.wrangler/worker/index.js'),
      true,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const mutation of ['changed', 'added', 'removed', 'identity', 'symlink']) {
  test(`verification rejects ${mutation} release content`, async () => {
    const f = await fixture();
    try {
      await packageRelease(f.source, f.release, identity);
      const index = path.join(f.release, 'dist/index.html');
      if (mutation === 'changed') await writeFile(index, 'tampered');
      if (mutation === 'added')
        await writeFile(path.join(f.release, 'dist/extra.txt'), 'unreviewed');
      if (mutation === 'removed') await rm(index);
      if (mutation === 'symlink') {
        await rm(index);
        await symlink(path.join(f.source, 'dist/index.html'), index);
      }
      if (mutation === 'identity') {
        const manifest = await verifyRelease(f.release);
        manifest.commit = 'b'.repeat(40);
        await writeFile(path.join(f.release, 'release.json'), JSON.stringify(manifest));
      }
      await assert.rejects(verifyRelease(f.release));
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
}

test('release packaging rejects prototype routes and symlinked source assets', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.source, 'dist/prototypes'));
    await assert.rejects(
      packageRelease(f.source, f.release, identity, {
        forbiddenPaths: ['patterns', 'prototypes'],
        forbiddenLanguages: ['en-XA'],
      }),
      /preview-only/i,
    );
    await rm(path.join(f.source, 'dist/prototypes'), { recursive: true });
    await symlink(path.join(f.source, 'dist/index.html'), path.join(f.source, 'dist/linked.html'));
    await assert.rejects(packageRelease(f.source, f.release, identity), /symbolic/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('generic apps may release prototype paths and test languages unless their policy forbids them', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.source, 'dist/prototypes'));
    await writeFile(
      path.join(f.source, 'dist/prototypes/index.html'),
      '<html lang="en-XA"></html>',
    );
    assert.equal((await packageRelease(f.source, f.release, identity)).releaseId, '12345');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('pure Workers use the same sealed inventory without requiring fabricated HTML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worker-seal-'));
  try {
    await mkdir(path.join(root, '.wrangler/worker'), { recursive: true });
    await writeFile(path.join(root, '.wrangler/worker/index.js'), 'export default {}');
    await writeFile(path.join(root, 'wrangler.jsonc'), '{"name":"worker"}');
    const release = await sealSavedRelease(root, identity, 'worker');
    assert.equal(release.artifactKind, 'worker');
    assert.deepEqual(await verifyRelease(root), release);
    const tampered = { ...release };
    delete tampered.artifactKind;
    await writeFile(path.join(root, 'release.json'), JSON.stringify(tampered));
    await assert.rejects(verifyRelease(root), /identity or files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('new artifacts bind format version into identity while legacy hashes remain unchanged', async () => {
  const f = await fixture();
  try {
    const release = await packageRelease(f.source, f.release, identity, { formatVersion: 2 });
    assert.equal(release.formatVersion, 2);
    assert.deepEqual(await verifyRelease(f.release), release);
    await writeFile(
      path.join(f.release, 'release.json'),
      JSON.stringify({ ...release, formatVersion: 1 }),
    );
    await assert.rejects(verifyRelease(f.release), /identity or files/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
