import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { verifyRelease, type SavedReleaseIdentity } from './saved-release-artifact.js';
import { verifyPreviewModuleImports } from './preview-module-imports.js';

const repository = z.object({ full_name: z.string() });
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const completedBuild = z.object({
  id: z.number().int().positive(),
  event: z.literal('pull_request'),
  status: z.literal('completed'),
  conclusion: z.literal('success'),
  path: z.string(),
  head_sha: sha,
  repository,
  head_repository: repository,
});
const openPr = z.object({
  number: z.number().int().positive(),
  state: z.literal('open'),
  head: z.object({ sha, repo: repository }),
  base: z.object({ ref: z.string(), repo: repository }),
});
export function assertPreviewBuild(
  input: unknown,
  pullRequest: unknown,
  policy: { repository: string; workflow: string; branch: string },
  id: string,
): SavedReleaseIdentity & { number: number } {
  const run = completedBuild.parse(input);
  const pr = openPr.parse(pullRequest);
  if (
    String(run.id) !== id ||
    run.path !== policy.workflow ||
    [run.repository, run.head_repository, pr.head.repo, pr.base.repo].some(
      (repo) => repo.full_name !== policy.repository,
    ) ||
    pr.base.ref !== policy.branch ||
    pr.head.sha !== run.head_sha
  )
    throw new Error('Preview build does not match the current same-repository pull request.');
  return { commit: run.head_sha, releaseId: id, number: pr.number };
}

/** Never import, bundle, run migrations from, or use configuration supplied by the PR. */
export async function preparePreviewUpload(
  source: string,
  destination: string,
  input: unknown,
  selection: { identity: SavedReleaseIdentity; worker: string },
): Promise<void> {
  const { identity, worker } = selection;
  const release = await verifyRelease(source);
  if (
    release.commit !== identity.commit ||
    release.releaseId !== identity.releaseId ||
    release.app !== identity.app
  )
    throw new Error('PR artifact identity differs from its validated build.');
  const trusted = z
    .object({
      compatibility_date: z.string(),
      compatibility_flags: z.array(z.string()),
      env: z.object({ preview: z.record(z.string(), z.unknown()) }),
    })
    .parse(input);
  const preview = trusted.env.preview;
  if (preview.name !== worker)
    throw new Error('Trusted preview configuration selects another Worker.');
  const module = await readFile(path.join(source, '.wrangler/worker/index.js'), 'utf8');
  verifyPreviewModuleImports(module);
  await mkdir(path.join(destination, '.wrangler/worker'), { recursive: true });
  await writeFile(path.join(destination, '.wrangler/worker/index.js'), module);
  if (preview.assets)
    await cp(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
  await writeFile(
    path.join(destination, 'wrangler.jsonc'),
    JSON.stringify(
      {
        ...preview,
        name: worker,
        main: '.wrangler/worker/index.js',
        compatibility_date: trusted.compatibility_date,
        compatibility_flags: trusted.compatibility_flags,
        assets: preview.assets
          ? { ...z.record(z.string(), z.unknown()).parse(preview.assets), directory: './dist' }
          : undefined,
        // Version uploads never change live routes, schedules, or the staging deployment.
        routes: [],
        triggers: { crons: [] },
        preview_urls: true,
        upload_source_maps: false,
        find_additional_modules: false,
      },
      null,
      2,
    ),
  );
}
