import { describe, expect, it } from 'vitest';
import {
  closePatternTerminus,
  dividePatternAtPosition,
  endPatternAtPosition,
  extendPatternTerminus,
  patternPositionAt,
} from '../../src/model/serviceEdits';
import { oneSection, stretchLeg, wholeLeg } from '../../src/model/geo/servicePaths';
import { aRoad } from '../support/fixtures.test';
import type { LngLat, Pattern, Way } from '../../src/model/system';

describe('pattern positions', () => {
  it('keeps repeated visits to one way as distinct positions', () => {
    const way = aRoad('loop', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const pattern: Pattern = {
      id: 'pattern',
      sections: oneSection([wholeLeg('loop'), wholeLeg('loop', 'againstPoints')]),
    };

    const first = patternPositionAt([way] as Way[], pattern, 'outbound', 0, 0.5);
    const second = patternPositionAt([way] as Way[], pattern, 'outbound', 1, 0.5);

    expect(first).toMatchObject({
      patternId: 'pattern',
      run: 'outbound',
      legIndex: 0,
      wayId: 'loop',
      t: 0.5,
    });
    expect(second).toMatchObject({
      patternId: 'pattern',
      run: 'outbound',
      legIndex: 1,
      wayId: 'loop',
      t: 0.5,
    });
    expect(second!.distanceMeters).toBeGreaterThan(first!.distanceMeters);
  });
});

describe('terminus extensions', () => {
  const pattern: Pattern = {
    id: 'couplet',
    sections: [
      { kind: 'shared', legs: [wholeLeg('a')] },
      { kind: 'split', outbound: [wholeLeg('b')], inbound: [wholeLeg('back')] },
    ],
  };

  it('adds a shared section beyond the outbound terminus of a couplet', () => {
    const extended = extendPatternTerminus(pattern, 'end', [wholeLeg('c')]);

    expect(extended?.sections).toEqual([
      ...pattern.sections,
      { kind: 'shared', legs: [wholeLeg('c')] },
    ]);
  });
});

describe('terminus closures', () => {
  const a: LngLat = [-115.2, 36.1];
  const b: LngLat = [-115.19, 36.1];
  const c: LngLat = [-115.18, 36.1];
  const d: LngLat = [-115.185, 36.11];
  const ways = [
    aRoad('a-b', [a, b]),
    aRoad('b-c', [b, c]),
    aRoad('a-d', [a, d]),
    aRoad('c-d', [c, d]),
    aRoad('d-b', [d, b]),
  ];
  const pattern: Pattern = {
    id: 'line',
    sections: oneSection([wholeLeg('a-b'), wholeLeg('b-c')]),
  };

  it('turns the tail into a couplet when an extension closes onto the line', () => {
    const atB = patternPositionAt(ways, pattern, 'outbound', 0, 1)!;
    const closed = closePatternTerminus(ways, pattern, 'end', atB, [
      wholeLeg('c-d'),
      wholeLeg('d-b'),
    ]);

    expect(closed?.sections).toEqual([
      { kind: 'shared', legs: [wholeLeg('a-b')] },
      {
        kind: 'split',
        outbound: [wholeLeg('b-c')],
        inbound: [wholeLeg('c-d'), wholeLeg('d-b')],
      },
    ]);
  });

  it('turns the head into a couplet when the start terminus closes onto the line', () => {
    const atB = patternPositionAt(ways, pattern, 'outbound', 1, 0)!;
    const closed = closePatternTerminus(ways, pattern, 'start', atB, [
      wholeLeg('a-d'),
      wholeLeg('d-b'),
    ]);

    expect(closed?.sections).toEqual([
      {
        kind: 'split',
        outbound: [wholeLeg('a-d'), wholeLeg('d-b')],
        inbound: [wholeLeg('a-b', 'againstPoints')],
      },
      { kind: 'shared', legs: [wholeLeg('b-c')] },
    ]);
  });

  it('refuses an empty closure without changing the pattern', () => {
    const atB = patternPositionAt(ways, pattern, 'outbound', 0, 1)!;

    expect(closePatternTerminus(ways, pattern, 'end', atB, [])).toBeNull();
    expect(pattern.sections).toEqual(oneSection([wholeLeg('a-b'), wholeLeg('b-c')]));
  });

  it('refuses a closure whose route does not join both of its claimed endpoints', () => {
    const atB = patternPositionAt(ways, pattern, 'outbound', 0, 1)!;

    expect(closePatternTerminus(ways, pattern, 'end', atB, [wholeLeg('d-b')])).toBeNull();
  });
});

describe('ending a line at an exact position', () => {
  it('keeps the longer operating path even when the hit is on a repeated way', () => {
    const ways = [
      aRoad('out', [
        [-115.2, 36.1],
        [-115.19, 36.1],
      ]),
      aRoad('return', [
        [-115.19, 36.1],
        [-115.18, 36.1],
      ]),
    ];
    const pattern: Pattern = {
      id: 'loop',
      sections: oneSection([wholeLeg('out'), wholeLeg('return'), wholeLeg('out', 'againstPoints')]),
    };
    const onReturn = patternPositionAt(ways, pattern, 'outbound', 1, 0.25)!;

    const result = endPatternAtPosition(ways, pattern, onReturn);

    expect(result?.side).toBe('start');
    expect(result?.pattern.sections).toEqual(
      oneSection([stretchLeg(wholeLeg('return'), 0.25, 1), wholeLeg('out', 'againstPoints')]),
    );
  });

  it('preserves a couplet while ending it at an outbound occurrence', () => {
    const ways = [
      aRoad('trunk', [
        [-115.2, 36.1],
        [-115.19, 36.1],
      ]),
      aRoad('up', [
        [-115.19, 36.1],
        [-115.18, 36.1],
      ]),
      aRoad('down', [
        [-115.18, 36.1],
        [-115.19, 36.1],
      ]),
      aRoad('north', [
        [-115.18, 36.1],
        [-115.179, 36.1],
      ]),
    ];
    const pattern: Pattern = {
      id: 'couplet',
      sections: [
        { kind: 'shared', legs: [wholeLeg('trunk')] },
        { kind: 'split', outbound: [wholeLeg('up')], inbound: [wholeLeg('down')] },
        { kind: 'shared', legs: [wholeLeg('north')] },
      ],
    };
    const position = patternPositionAt(ways, pattern, 'outbound', 1, 0.8)!;

    const result = endPatternAtPosition(ways, pattern, position);

    expect(result?.side).toBe('end');
    expect(result?.pattern.sections[0]).toEqual({ kind: 'shared', legs: [wholeLeg('trunk')] });
    const split = result?.pattern.sections[1];
    expect(split).toMatchObject({ kind: 'split', outbound: [stretchLeg(wholeLeg('up'), 0, 0.8)] });
    expect(split?.kind === 'split' && split.inbound[0].extent.kind === 'stretch').toBe(true);
    if (split?.kind === 'split' && split.inbound[0].extent.kind === 'stretch') {
      expect(split.inbound[0].extent.fromT).toBeCloseTo(0.2);
      expect(split.inbound[0].extent.toT).toBe(1);
    }
  });
});

describe('dividing a focused pattern', () => {
  it('returns the shorter half while leaving the longer half to retain the service', () => {
    const ways = [
      aRoad('long', [
        [-115.2, 36.1],
        [-115.17, 36.1],
      ]),
      aRoad('short', [
        [-115.17, 36.1],
        [-115.16, 36.1],
      ]),
    ];
    const pattern: Pattern = {
      id: 'focused',
      sections: oneSection([wholeLeg('long'), wholeLeg('short')]),
    };
    const cut = patternPositionAt(ways, pattern, 'outbound', 0, 0.8)!;

    const divided = dividePatternAtPosition(ways, pattern, cut);

    expect(divided?.remaining.sections).toEqual(oneSection([stretchLeg(wholeLeg('long'), 0, 0.8)]));
    expect(divided?.divided.sections).toEqual(
      oneSection([stretchLeg(wholeLeg('long'), 0.8, 1), wholeLeg('short')]),
    );
  });
});
