import { describe, expect, it } from 'vitest';
import { classifyOsmWay } from '../../src/model/import';
import { isMajorRoad } from '../../src/model/catalog';

describe('major-road classification', () => {
  it('classifies a motorway as major', () => {
    const kind = classifyOsmWay({ highway: 'motorway' });
    expect(kind).not.toBeNull();
    expect(isMajorRoad({ typeId: kind!.typeId, classId: kind!.classId })).toBe(true);
  });

  it('classifies trunk, primary, and secondary roads as major', () => {
    for (const highway of ['trunk', 'primary', 'secondary']) {
      const kind = classifyOsmWay({ highway });
      expect(isMajorRoad({ typeId: kind!.typeId, classId: kind!.classId })).toBe(true);
    }
  });

  it('classifies a tertiary road as not major', () => {
    const kind = classifyOsmWay({ highway: 'tertiary' });
    expect(isMajorRoad({ typeId: kind!.typeId, classId: kind!.classId })).toBe(false);
  });

  it('classifies residential, unclassified, and living-street roads as not major', () => {
    for (const highway of ['residential', 'unclassified', 'living_street']) {
      const kind = classifyOsmWay({ highway });
      expect(isMajorRoad({ typeId: kind!.typeId, classId: kind!.classId })).toBe(false);
    }
  });

  it('treats a way with no class as not major', () => {
    expect(isMajorRoad({ typeId: 'road', classId: undefined })).toBe(false);
  });

  it('treats a non-road way type as not major regardless of classId', () => {
    expect(isMajorRoad({ typeId: 'heavyRail', classId: 'arterial' })).toBe(false);
  });
});
