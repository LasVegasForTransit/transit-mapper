import { describe, expect, it } from 'vitest';
import {
  createRendererFixture,
  RENDERER_FIXTURE_DESCRIPTORS,
} from '../../src/perf/renderer-fixtures';

describe('renderer visual fixtures', () => {
  it('covers every renderer risk with a stable dedicated scene', () => {
    expect(RENDERER_FIXTURE_DESCRIPTORS.map((fixture) => fixture.id)).toEqual([
      'port-mason',
      'dense-downtown',
      'rtc-scale',
      'acute-junction',
      'five-arm-junction',
      'grade-stack',
      'noisy-curves',
      'rail-guideway',
      'shared-service-trunk',
      'complex-diagram',
    ]);
    expect(new Set(RENDERER_FIXTURE_DESCRIPTORS.map((fixture) => fixture.id)).size).toBe(10);
  });

  it('builds every scene deterministically without sharing mutable documents', () => {
    for (const descriptor of RENDERER_FIXTURE_DESCRIPTORS) {
      const first = createRendererFixture(descriptor.id);
      const second = createRendererFixture(descriptor.id);

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(first.ways.length).toBeGreaterThan(0);
      expect(first.viewport).toEqual(descriptor.camera);
    }
  });

  it('keeps the specialized fixtures truthful to the geometry they exercise', () => {
    expect(createRendererFixture('port-mason').name).toBe('Port Mason renderer reference');
    expect(createRendererFixture('dense-downtown').ways).toHaveLength(600);
    expect(createRendererFixture('rtc-scale').ways).toHaveLength(3_800);
    expect(createRendererFixture('acute-junction').nodes[0]?.refs).toHaveLength(3);
    expect(createRendererFixture('five-arm-junction').nodes[0]?.refs).toHaveLength(5);
    expect(new Set(createRendererFixture('grade-stack').ways.map((way) => way.grade))).toEqual(
      new Set(['underground', 'atGrade', 'elevated']),
    );
    expect(createRendererFixture('noisy-curves').ways.map((way) => way.geometry)).toEqual([
      'curved',
      'freeform',
    ]);
    expect(
      createRendererFixture('rail-guideway').ways.every((way) => way.typeId === 'lightRail'),
    ).toBe(true);
    expect(createRendererFixture('shared-service-trunk').services).toHaveLength(3);
    expect(createRendererFixture('complex-diagram').services.length).toBeGreaterThanOrEqual(4);
  });
});
