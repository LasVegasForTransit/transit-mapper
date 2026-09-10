import { execFileSync } from 'node:child_process';
import { z } from 'zod';

export function githubReader(root: string) {
  return (endpoint: string): Promise<unknown> => {
    if (!/^repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/|$)/.test(endpoint) || endpoint.includes('..'))
      return Promise.reject(new Error('GitHub reads require a repository API path.'));
    try {
      const output = execFileSync(
        'gh',
        ['api', '--hostname', 'github.com', '--method', 'GET', '--paginate', '--slurp', endpoint],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const pages = z.array(z.unknown()).min(1).parse(JSON.parse(output));
      if (pages.length === 1) return Promise.resolve(pages[0]);
      if (pages.every(Array.isArray)) return Promise.resolve(pages.flat());
      const records = z.array(z.record(z.string(), z.unknown())).parse(pages);
      const first = { ...records[0] };
      for (const key of ['variables', 'secrets', 'branch_policies'])
        if (key in first)
          first[key] = records.flatMap((record) => z.array(z.unknown()).parse(record[key]));
      return Promise.resolve(first);
    } catch {
      return Promise.reject(
        new Error('GitHub read failed. Check authentication and repository permissions.'),
      );
    }
  };
}
