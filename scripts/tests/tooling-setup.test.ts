import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localEnvironment } from '@lasvegasfortransit/cli/local';

const ROOT = resolve(import.meta.dirname, '../..');
interface Tooling {
  local: { env: { example: string; file: string }[] };
}
const tooling = JSON.parse(readFileSync(join(ROOT, '.lvbt/tooling.json'), 'utf8')) as Tooling;

describe('local contributor setup', () => {
  it('reports missing files without creating them or requesting production access', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'tm-local-preflight-'));
    try {
      mkdirSync(join(fixture, '.lvbt'));
      mkdirSync(join(fixture, 'apps/web'), { recursive: true });
      writeFileSync(join(fixture, '.lvbt/tooling.json'), JSON.stringify(tooling));
      writeFileSync(
        join(fixture, 'apps/web/.env.example'),
        readFileSync(join(ROOT, 'apps/web/.env.example')),
      );
      const findings = localEnvironment(fixture);
      expect(findings.some((finding) => !finding.ok)).toBe(true);
      expect(existsSync(join(fixture, 'apps/web/.env.development.local'))).toBe(false);
      expect(JSON.stringify(findings)).not.toMatch(/gh auth|wrangler login|CLOUDFLARE_API_TOKEN/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it('seeds local defaults once and preserves a contributors existing values', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'tm-local-bootstrap-'));
    try {
      mkdirSync(join(fixture, '.lvbt'));
      mkdirSync(join(fixture, 'apps/web'), { recursive: true });
      writeFileSync(join(fixture, '.lvbt/tooling.json'), JSON.stringify(tooling));
      writeFileSync(
        join(fixture, 'apps/web/.env.example'),
        readFileSync(join(ROOT, 'apps/web/.env.example')),
      );
      expect(localEnvironment(fixture, { apply: true }).every((finding) => finding.ok)).toBe(true);
      const file = join(fixture, 'apps/web/.env.development.local');
      expect(readFileSync(file, 'utf8')).toContain('VITE_SITE_URL=http://localhost:5173');
      const existing =
        'VITE_SITE_URL=http://localhost:6000\nPUBLIC_LVBT_CWA_TOKEN=existing-public-token\n';
      writeFileSync(file, existing);
      const report = localEnvironment(fixture, { apply: true });
      expect(readFileSync(file, 'utf8')).toBe(existing);
      expect(JSON.stringify(report)).not.toContain('existing-public-token');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
