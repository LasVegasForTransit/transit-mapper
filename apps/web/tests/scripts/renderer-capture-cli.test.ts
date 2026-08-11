import { describe, expect, it } from 'vitest';
import { basename, dirname } from 'node:path';
import { parseRendererCaptureCliOptions } from '../../scripts/renderer-capture/cli';

describe('renderer capture CLI', () => {
  it('selects a phase and optional profile/theme subset', () => {
    expect(
      parseRendererCaptureCliOptions([
        '--phase',
        '02-physical-geometry',
        '--profile',
        'mobile',
        '--theme',
        'dark',
        '--skip-build',
      ]),
    ).toMatchObject({
      phase: '02-physical-geometry',
      profile: 'mobile',
      theme: 'dark',
      skipBuild: true,
    });
  });

  it('rejects a phase that could escape the artifact directory', () => {
    expect(() => parseRendererCaptureCliOptions(['--phase', '../outside'])).toThrow(
      '--phase must contain only lowercase letters, numbers, and hyphens.',
    );
  });

  it('does not accept an arbitrary cleanup output directory', () => {
    expect(() =>
      parseRendererCaptureCliOptions([
        '--phase',
        '00-baseline',
        '--output',
        '/tmp/renderer-danger',
      ]),
    ).toThrow('Unknown renderer capture option: --output');

    const options = parseRendererCaptureCliOptions(['--phase', '00-baseline']);
    expect(dirname(options.outputDirectory)).toMatch(/apps\/web\/artifacts\/renderer$/);
  });

  it('keeps diagnostic subsets outside the canonical numbered phase directory', () => {
    const complete = parseRendererCaptureCliOptions(['--phase', '01-lod']);
    const subset = parseRendererCaptureCliOptions([
      '--phase',
      '01-lod',
      '--profile',
      'mobile',
      '--theme',
      'dark',
    ]);

    expect(basename(complete.outputDirectory)).toBe('01-lod');
    expect(basename(subset.outputDirectory)).toBe('diagnostic-01-lod-mobile-dark');
  });
});
