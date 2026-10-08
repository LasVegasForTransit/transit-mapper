import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { sealSavedRelease } from '../src/saved-release-artifact.js';
import { createReleaseAttestation, verifyReleaseAttestation } from '../src/release-attestation.js';

const config = {
  repository: 'LasVegasForTransit/transit-mapper',
  attestation: {
    signerWorkflow: 'LasVegasForTransit/repository-tooling/.github/workflows/release-attest.yml',
    signerCommit: 'b'.repeat(40),
  },
};
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-attestation-'));
  roots.push(root);
  await mkdir(path.join(root, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(root, 'wrangler.jsonc'), '{}');
  await writeFile(
    path.join(root, '.wrangler/worker/index.js'),
    'export default {fetch(){return new Response("ok")}};',
  );
  const release = await sealSavedRelease(
    root,
    { commit: 'a'.repeat(40), releaseId: '123' },
    'worker',
    2,
  );
  const proof = await mkdtemp(path.join(os.tmpdir(), 'release-proof-'));
  roots.push(proof);
  await createReleaseAttestation(root, proof);
  await writeFile(path.join(proof, 'bundle.jsonl'), '{"signature":"fixture"}\n');
  const bin = await mkdtemp(path.join(os.tmpdir(), 'release-verifier-'));
  roots.push(bin);
  const capture = path.join(bin, 'command.json');
  await writeFile(
    path.join(bin, 'gh'),
    '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.ATTESTATION_CAPTURE,JSON.stringify(process.argv.slice(2)));if(process.env.PROOF_MUTATION_FILE)require("node:fs").writeFileSync(process.env.PROOF_MUTATION_FILE,process.env.PROOF_MUTATION_CONTENT);process.exit(Number(process.env.ATTESTATION_FAILURE||0));\n',
  );
  await chmod(path.join(bin, 'gh'), 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
  vi.stubEnv('ATTESTATION_CAPTURE', capture);
  return { root, proof, release, capture };
}

test('signed release inventory binds all saved bytes to the source and reviewed shared signer', async () => {
  const f = await fixture();
  expect(
    JSON.parse(await readFile(path.join(f.proof, 'release-attestation.json'), 'utf8')),
  ).toEqual(f.release);
  await verifyReleaseAttestation(config, f.root, f.proof);
  const args = JSON.parse(await readFile(f.capture, 'utf8')) as string[];
  expect(args).toEqual([
    'attestation',
    'verify',
    expect.stringMatching(/lvbt-attestation-.*\/release-attestation\.json$/),
    '--bundle',
    expect.stringMatching(/lvbt-attestation-.*\/bundle\.jsonl$/),
    '--repo',
    config.repository,
    '--signer-workflow',
    config.attestation.signerWorkflow,
    '--signer-digest',
    config.attestation.signerCommit,
    '--source-digest',
    f.release.commit,
    '--source-ref',
    'refs/heads/main',
    '--deny-self-hosted-runners',
  ]);
});

test('failed signature verification cannot establish deployment provenance', async () => {
  const f = await fixture();
  vi.stubEnv('ATTESTATION_FAILURE', '1');
  await expect(verifyReleaseAttestation(config, f.root, f.proof)).rejects.toThrow('attestation');
});

test('another correctly signed release cannot authorize the selected artifact', async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.proof, 'release-attestation.json'),
    JSON.stringify({ ...f.release, releaseId: '124' }),
  );
  await expect(verifyReleaseAttestation(config, f.root, f.proof)).rejects.toThrow(
    'selected release',
  );
});

test('modified saved bytes are rejected before consulting the verifier', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, '.wrangler/worker/index.js'), 'tampered');
  await expect(verifyReleaseAttestation(config, f.root, f.proof)).rejects.toThrow();
  await expect(readFile(f.capture)).rejects.toThrow();
});

test('required attestations reject missing proof or a missing signer pin', async () => {
  const f = await fixture();
  await expect(verifyReleaseAttestation(config, f.root)).rejects.toThrow('attestation');
  await expect(
    verifyReleaseAttestation(
      { ...config, attestation: { ...config.attestation, signerCommit: 'main' } },
      f.root,
      f.proof,
    ),
  ).rejects.toThrow();
  await rm(path.join(f.proof, 'bundle.jsonl'));
  await expect(verifyReleaseAttestation(config, f.root, f.proof)).rejects.toThrow();
});

test('proof mutation during signature verification cannot change the signed inventory', async () => {
  const f = await fixture();
  const manifest = path.join(f.proof, 'release-attestation.json');
  await writeFile(manifest, JSON.stringify({ ...f.release, releaseId: '124' }));
  vi.stubEnv('PROOF_MUTATION_FILE', manifest);
  vi.stubEnv('PROOF_MUTATION_CONTENT', JSON.stringify(f.release));
  await expect(verifyReleaseAttestation(config, f.root, f.proof)).rejects.toThrow(
    'selected release',
  );
});

test('signing a retained inventory rejects a different source run before writing proof', async () => {
  const f = await fixture();
  const another = path.join(f.proof, 'another');
  await expect(
    createReleaseAttestation(f.root, another, { commit: 'b'.repeat(40), releaseId: '123' }),
  ).rejects.toThrow('selected build run');
  await expect(readFile(path.join(another, 'release-attestation.json'))).rejects.toThrow();
});
