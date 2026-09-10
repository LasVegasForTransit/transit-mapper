import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { sealArtifact, verifyReleaseResponse } from '../src/release-artifact.ts';

const identity = { slug: 'map', commit: 'a'.repeat(40) };

test('includes same-named data files outside the release marker location in the checksum', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-release-'));
  try {
    await mkdir(path.join(directory, 'data'));
    await writeFile(path.join(directory, 'index.html'), '<h1>Map</h1>');
    const data = path.join(directory, 'data/lvbt-release.json');
    await writeFile(data, '{"value":1}');
    const first = await sealArtifact(directory, identity);
    await writeFile(data, '{"value":2}');
    expect((await sealArtifact(directory, identity)).artifactHash).not.toBe(first.artifactHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('seals assets deterministically and detects changed bytes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-release-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<h1>Map</h1>');
    const first = await sealArtifact(directory, identity);
    expect(await sealArtifact(directory, identity)).toEqual(first);
    expect(
      JSON.parse(await readFile(path.join(directory, 'map/lvbt-release.json'), 'utf8')),
    ).toEqual(first);
    await writeFile(path.join(directory, 'index.html'), '<h1>Updated map</h1>');
    expect((await sealArtifact(directory, identity)).artifactHash).not.toBe(first.artifactHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('supports prefixed static asset layouts and refuses symlinked content', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lab-release-'));
  try {
    await mkdir(path.join(directory, 'map'));
    await writeFile(path.join(directory, 'map/index.html'), '<h1>Map</h1>');
    const marker = await sealArtifact(directory, identity);
    expect(
      JSON.parse(await readFile(path.join(directory, 'map/lvbt-release.json'), 'utf8')),
    ).toEqual(marker);
    await symlink('/etc/hosts', path.join(directory, 'external'));
    await expect(sealArtifact(directory, identity)).rejects.toThrow(/symbolic link/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a successful HTML response, wrong project, stale artifact, and redirects', async () => {
  const marker = { ...identity, formatVersion: 1 as const, artifactHash: 'b'.repeat(64) };
  await expect(verifyReleaseResponse(Response.json(marker), marker)).resolves.toBeUndefined();
  await expect(verifyReleaseResponse(new Response('<h1>Home</h1>'), marker)).rejects.toThrow();
  await expect(
    verifyReleaseResponse(Response.json({ ...marker, slug: 'home' }), marker),
  ).rejects.toThrow(/match/);
  await expect(
    verifyReleaseResponse(Response.json({ ...marker, artifactHash: 'c'.repeat(64) }), marker),
  ).rejects.toThrow(/match/);
  await expect(verifyReleaseResponse(new Response(null, { status: 302 }), marker)).rejects.toThrow(
    /302/,
  );
});
