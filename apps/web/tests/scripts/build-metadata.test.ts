import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEnvironment, loadBuildInfo } from '../../scripts/build-metadata';

const roots: string[] = [];

function repository(packageJson: object, license: string): string {
  const root = mkdtempSync(join(tmpdir(), 'transitmapper-build-info-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  writeFileSync(join(root, 'LICENSE'), license);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('build metadata', () => {
  it('exports Git identity for Turbo without dropping the release tag', () => {
    expect(
      buildEnvironment(
        { TRANSITMAPPER_RELEASE_TAG: 'v1.4.0', KEEP_ME: 'yes' },
        { commitSha: '0123456789abcdef0123456789abcdef01234567', dirty: true },
      ),
    ).toMatchObject({
      TRANSITMAPPER_BUILD_COMMIT: '0123456789abcdef0123456789abcdef01234567',
      TRANSITMAPPER_BUILD_DIRTY: '1',
      TRANSITMAPPER_RELEASE_TAG: 'v1.4.0',
      KEEP_ME: 'yes',
    });
  });

  it('keeps GitHub Actions identity when the checkout cannot run Git', () => {
    expect(
      buildEnvironment(
        {
          GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          TRANSITMAPPER_BUILD_DIRTY: '0',
        },
        null,
      ),
    ).toMatchObject({
      TRANSITMAPPER_BUILD_COMMIT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      TRANSITMAPPER_BUILD_DIRTY: '0',
    });
  });

  it('derives public build facts from the repository and Git checkout', () => {
    const root = repository(
      {
        version: '1.4.0',
        repository: {
          url: 'git+https://github.com/LasVegasForTransit/transit-mapper.git',
        },
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );

    expect(
      loadBuildInfo({
        repositoryRoot: root,
        environment: {},
        git: { commitSha: '0123456789abcdef0123456789abcdef01234567', dirty: true },
        now: new Date('2026-08-01T19:20:21.000Z'),
      }),
    ).toEqual({
      version: '1.4.0',
      repositoryUrl: 'https://github.com/LasVegasForTransit/transit-mapper',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
      commitUrl:
        'https://github.com/LasVegasForTransit/transit-mapper/commit/0123456789abcdef0123456789abcdef01234567',
      builtAt: '2026-08-01T19:20:21.000Z',
      dirty: true,
      copyrightNotice: 'Copyright (c) 2026 Las Vegans for Better Transit',
      releaseTag: null,
      releaseUrl: null,
      attestationsUrl: 'https://github.com/LasVegasForTransit/transit-mapper/attestations',
      performanceSampling: {
        enabled: true,
        ordinaryBasisPoints: 100,
        releaseBasisPoints: 500,
        boostUntil: null,
      },
    });
  });

  it('uses the release workflow inputs ahead of local Git state', () => {
    const root = repository(
      {
        version: '2.3.0',
        repository: 'https://github.com/LasVegasForTransit/transit-mapper',
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );

    const info = loadBuildInfo({
      repositoryRoot: root,
      environment: {
        TRANSITMAPPER_BUILD_COMMIT: 'fedcba9876543210fedcba9876543210fedcba98',
        TRANSITMAPPER_BUILD_DIRTY: '0',
        TRANSITMAPPER_RELEASE_TAG: 'v2.3.0',
      },
      git: { commitSha: '0123456789abcdef0123456789abcdef01234567', dirty: true },
      now: new Date('2026-08-01T19:20:21.000Z'),
    });

    expect(info.commitSha).toBe('fedcba9876543210fedcba9876543210fedcba98');
    expect(info.dirty).toBe(false);
    expect(info.releaseTag).toBe('v2.3.0');
    expect(info.releaseUrl).toBe(
      'https://github.com/LasVegasForTransit/transit-mapper/releases/tag/v2.3.0',
    );
    expect(info.performanceSampling).toEqual({
      enabled: true,
      ordinaryBasisPoints: 100,
      releaseBasisPoints: 500,
      boostUntil: '2026-08-02T19:20:21.000Z',
    });
  });

  it('uses GitHub Actions commit identity without requiring a custom variable', () => {
    const root = repository(
      {
        version: '0.1.0',
        repository: {
          url: 'git+https://github.com/LasVegasForTransit/transit-mapper.git',
        },
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );

    const info = loadBuildInfo({
      repositoryRoot: root,
      environment: { GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      git: null,
      now: new Date('2026-08-01T19:20:21.000Z'),
    });

    expect(info.commitSha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(info.dirty).toBe(false);
  });

  it('builds without Git while refusing to invent revision provenance', () => {
    const root = repository(
      {
        version: '0.1.0',
        repository: {
          url: 'git+https://github.com/LasVegasForTransit/transit-mapper.git',
        },
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );

    const info = loadBuildInfo({
      repositoryRoot: root,
      environment: {},
      git: null,
      now: new Date('2026-08-01T19:20:21.000Z'),
    });

    expect(info.commitSha).toBeNull();
    expect(info.commitUrl).toBeNull();
    expect(info.dirty).toBe(false);
  });

  it('refuses a release tag that disagrees with the canonical version', () => {
    const root = repository(
      {
        version: '1.0.0',
        repository: {
          url: 'git+https://github.com/LasVegasForTransit/transit-mapper.git',
        },
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );

    expect(() =>
      loadBuildInfo({
        repositoryRoot: root,
        environment: { TRANSITMAPPER_RELEASE_TAG: 'v2.0.0' },
        git: null,
        now: new Date('2026-08-01T19:20:21.000Z'),
      }),
    ).toThrow('release tag v2.0.0 does not match package version 1.0.0');
  });

  it('provides a build-time kill switch and validates sampling basis points', () => {
    const root = repository(
      {
        version: '1.0.0',
        repository: 'https://github.com/LasVegasForTransit/transit-mapper',
      },
      'MIT License\n\nCopyright (c) 2026 Las Vegans for Better Transit\n',
    );
    const base = {
      repositoryRoot: root,
      git: null,
      now: new Date('2026-08-01T19:20:21.000Z'),
    };

    expect(
      loadBuildInfo({
        ...base,
        environment: {
          TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED: '0',
          TRANSITMAPPER_PERFORMANCE_ORDINARY_BASIS_POINTS: '250',
          TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS: '750',
        },
      }).performanceSampling,
    ).toEqual({
      enabled: false,
      ordinaryBasisPoints: 250,
      releaseBasisPoints: 750,
      boostUntil: null,
    });
    expect(() =>
      loadBuildInfo({
        ...base,
        environment: { TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS: '10001' },
      }),
    ).toThrow('TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS must be an integer from 0 to 10000');
  });
});
