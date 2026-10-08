import { productionEndpoint } from './release-path.js';
import type { ReleaseConfiguration } from './release-config.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { github, githubJson } from './release-github.js';
import { promotionRequest, type PromotionRun } from './promotion-request.js';
import { publicationSchema } from './publication.js';
import { waitForReleaseIdentity } from './release-identity.js';

export async function runPromote(
  config: ReleaseConfiguration,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  if (config.previewOnly) throw new Error('Preview-only apps cannot request production promotion.');
  const { values } = parseArgs({
    args,
    options: {
      'run-id': { type: 'string' },
      'expected-version': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: pnpm promote [--run-id <successful staging Actions run ID>]\nPromotes current preview by default, using GitHub environment credentials. Requires gh authentication with Actions write access.\n',
    );
  } else {
    if (values['expected-version']) z.uuid().parse(values['expected-version']);
    const repository = config.repository;
    const repo = z
      .object({ nameWithOwner: z.literal(repository) })
      .parse(await githubJson(['repo', 'view', '--json', 'nameWithOwner']));
    const endpoint = `repos/${repo.nameWithOwner}/actions/workflows/${config.promotionWorkflow.file}`;
    z.object({ state: z.literal('active') }).parse(await githubJson(['api', endpoint]));
    const requestId = randomUUID();
    process.stdout.write(
      `Request: ${requestId}\nResolving the selected preview release in GitHub Actions.\n`,
    );
    const run = await promotionRequest(requestId, values['run-id'], {
      workflow: {
        titlePrefix: config.promotionWorkflow.titlePrefix,
        branch: config.promotionWorkflow.branch,
        path: `.github/workflows/${config.promotionWorkflow.file}`,
      },
      dispatch: async (id, releaseId) => {
        const args = [
          'api',
          `${endpoint}/dispatches`,
          '--method',
          'POST',
          '-f',
          `ref=${config.promotionWorkflow.branch}`,
          '-f',
          `inputs[request_id]=${id}`,
        ];
        if (releaseId) args.push('-f', `inputs[run_id]=${releaseId}`);
        if (config.profile) args.push('-f', `inputs[app]=${config.profile}`);
        if (values['expected-version'])
          args.push('-f', `inputs[expected_version]=${values['expected-version']}`);
        await github(args);
      },
      listRuns: async () =>
        await githubJson([
          'api',
          `${endpoint}/runs?event=workflow_dispatch&branch=${config.promotionWorkflow.branch}&per_page=100`,
        ]),
      getRun: async (id) => await githubJson(['api', `repos/${repository}/actions/runs/${id}`]),
      progress: (current) => process.stdout.write(`${current.status}: ${current.html_url}\n`),
    });
    await verifyPublication(config, run);
  }
}

async function verifyPublication(config: ReleaseConfiguration, run: PromotionRun): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-publication-'));
  try {
    try {
      await github([
        'run',
        'download',
        String(run.id),
        '--repo',
        config.repository,
        '--name',
        `publication-${run.id}-${run.run_attempt}${config.profile ? `-${config.profile}` : ''}`,
        '--dir',
        directory,
      ]);
    } catch {
      throw new Error(
        `Promotion ${run.conclusion}; publication receipt unavailable. Inspect ${run.html_url} before dispatching again.`,
      );
    }
    const receipt = publicationSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'publication.json'), 'utf8')),
    );
    if (receipt.url !== productionEndpoint(config) || receipt.release.app !== config.profile)
      throw new Error(
        `Publication receipt targets another site. Inspect ${run.html_url}; do not redispatch.`,
      );
    process.stdout.write(`${JSON.stringify({ run: run.html_url, ...receipt }, null, 2)}\n`);
    if (receipt.activation === 'confirmed')
      await waitForReleaseIdentity(config.productionUrl, receipt.release, {
        publicPath: config.publicPath,
      });
    if (
      run.conclusion !== 'success' ||
      receipt.activation !== 'confirmed' ||
      receipt.verification !== 'success'
    )
      throw new Error(
        `Promotion ${run.conclusion}; activation ${receipt.activation}; public verification ${receipt.verification}. Inspect ${run.html_url}. Do not blindly redispatch.`,
      );
    process.stdout.write(
      `Published release ${receipt.release.releaseId} at ${receipt.url}; live marker verified.\n`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
