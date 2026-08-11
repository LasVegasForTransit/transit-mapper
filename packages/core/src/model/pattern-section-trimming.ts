import { nearestOnPath, pointAtT, resolveWayPath } from './geo';
import { pruneSections, truncateLegs } from './patternEdits';
import { patternSectionsEqual } from './service-path-edits';
import type { LngLat, PatternLeg, PatternSection, Way } from './system';

interface LegCut {
  legIndex: number;
  t: number;
}

export interface PatternSectionCut {
  wayId: string;
  t: number;
  side: 'start' | 'end';
}

function cutIndexOnLegs(ways: Way[], legs: PatternLeg[], coord: LngLat): LegCut | null {
  let best: (LegCut & { distanceMeters: number }) | null = null;
  for (const [legIndex, leg] of legs.entries()) {
    const way = ways.find((candidate) => candidate.id === leg.wayId);
    if (!way) continue;
    const nearest = nearestOnPath(resolveWayPath(way), coord);
    if (!nearest || (best && best.distanceMeters <= nearest.distMeters)) continue;
    best = { legIndex, t: nearest.t, distanceMeters: nearest.distMeters };
  }
  return best ? { legIndex: best.legIndex, t: best.t } : null;
}

function sectionLegs(section: PatternSection): PatternLeg[] {
  return section.kind === 'split' ? [...section.outbound, ...section.inbound] : section.legs;
}

function coordinateOnWay(ways: Way[], wayId: string, t: number): LngLat | null {
  const way = ways.find((candidate) => candidate.id === wayId);
  if (!way) return null;
  const path = resolveWayPath(way);
  return path.length >= 2 ? pointAtT(path, t) : null;
}

function trimSection(
  ways: Way[],
  section: PatternSection,
  cutRequest: PatternSectionCut,
): PatternSection | null {
  const { wayId, t, side } = cutRequest;
  const indexIn = (legs: PatternLeg[]): LegCut | null => {
    const matching = legs.flatMap((leg, index) => (leg.wayId === wayId ? [index] : []));
    const legIndex = (side === 'start' ? matching[0] : matching.at(-1)) ?? -1;
    return legIndex < 0 ? null : { legIndex, t };
  };
  const cut = (legs: PatternLeg[], at: LegCut, cutSide: 'start' | 'end') =>
    truncateLegs(legs, at.legIndex, at.t, cutSide);

  if (section.kind !== 'split') {
    const at = indexIn(section.legs);
    return at ? { ...section, legs: cut(section.legs, at, side) } : null;
  }

  const outboundAt = indexIn(section.outbound);
  if (!outboundAt) return null;
  const coord = coordinateOnWay(ways, wayId, t);
  const inboundAt = coord ? cutIndexOnLegs(ways, section.inbound, coord) : null;
  if (!inboundAt) return null;
  return {
    kind: 'split',
    outbound: cut(section.outbound, outboundAt, side),
    inbound: cut(section.inbound, inboundAt, side === 'end' ? 'start' : 'end'),
  };
}

/**
 * Cut structured sections at the matching occurrence nearest the moved end.
 * Split sections project the cut onto their return path so both runs survive.
 */
export function trimPatternSectionsTo(
  ways: Way[],
  sections: PatternSection[],
  cutRequest: PatternSectionCut,
): PatternSection[] | null {
  const { wayId, side } = cutRequest;
  const holdsWay = (section: PatternSection) =>
    sectionLegs(section).some((leg) => leg.wayId === wayId);
  let sectionIndex = sections.findIndex(holdsWay);
  if (side === 'end') {
    sectionIndex = -1;
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      if (!holdsWay(sections[index])) continue;
      sectionIndex = index;
      break;
    }
  }
  if (sectionIndex < 0) return null;
  const trimmed = trimSection(ways, sections[sectionIndex], cutRequest);
  if (!trimmed) return null;
  const kept =
    side === 'start' ? sections.slice(sectionIndex + 1) : sections.slice(0, sectionIndex);
  const next = pruneSections(side === 'start' ? [trimmed, ...kept] : [...kept, trimmed]);
  return patternSectionsEqual(sections, next) ? sections : next;
}
