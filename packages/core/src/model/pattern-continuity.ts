import {
  haversineMeters,
  oneSection,
  pathLengthMeters,
  patternHasSplit,
  patternRunSegments,
  patternSegments,
  wayById,
} from './geo';
import { mapSectionLegs, pruneSections, splitLegsIntoRuns } from './patternEdits';
import type { LngLat, Pattern, PatternLeg, PatternSection, RunDirection, Way } from './system';

const JOIN_TOLERANCE_M = 0.75;

/** Split a leg list wherever consecutive resolved paths no longer meet. */
export function splitContinuousLegRuns(ways: Way[], legs: PatternLeg[]): PatternLeg[][] {
  const waysById = wayById(ways);
  return splitLegsIntoRuns(legs, (left, right) => {
    const segments = patternSegments(waysById, {
      id: 'pattern-continuity-probe',
      sections: oneSection([left, right]),
    });
    if (segments.length < 2) return false;
    const leftPath = segments[0].path;
    const rightPath = segments[1].path;
    return haversineMeters(leftPath[leftPath.length - 1], rightPath[0]) <= JOIN_TOLERANCE_M;
  });
}

/** Select the physically longest run, retaining the earlier run on a tie. */
export function longestContinuousLegRun(ways: Way[], legs: PatternLeg[]): PatternLeg[] {
  const waysById = wayById(ways);
  const runs = splitContinuousLegRuns(ways, legs);
  if (runs.length === 0 || (runs.length === 1 && runs[0].length === legs.length)) return legs;
  return runs.reduce<{ legs: PatternLeg[]; meters: number }>(
    (longest, run) => {
      const segments = patternSegments(waysById, {
        id: 'pattern-length-probe',
        sections: oneSection(run),
      });
      const meters = segments.reduce((total, segment) => total + pathLengthMeters(segment.path), 0);
      return meters > longest.meters ? { legs: run, meters } : longest;
    },
    { legs: [], meters: -1 },
  ).legs;
}

type SharedSection = Extract<PatternSection, { kind: 'shared' }>;

function isSharedSection(section: PatternSection): section is SharedSection {
  return section.kind === 'shared';
}

function sharedSectionsWithinRun(
  sections: SharedSection[],
  runStart: number,
  runLength: number,
): PatternSection[] {
  const runEnd = runStart + runLength;
  const next: PatternSection[] = [];
  let sectionStart = 0;
  for (const section of sections) {
    const sectionEnd = sectionStart + section.legs.length;
    const first = Math.max(sectionStart, runStart);
    const last = Math.min(sectionEnd, runEnd);
    if (first < last) {
      const from = first - sectionStart;
      const to = last - sectionStart;
      const legs =
        from === 0 && to === section.legs.length ? section.legs : section.legs.slice(from, to);
      next.push(legs === section.legs ? section : { ...section, legs });
    }
    sectionStart = sectionEnd;
  }
  return next;
}

function longestSharedSectionRun(ways: Way[], sections: SharedSection[]): PatternSection[] {
  const nonEmpty = sections.filter((section) => section.legs.length > 0);
  const legs = nonEmpty.flatMap((section) => section.legs);
  if (legs.length === 0) return [];
  const run = longestContinuousLegRun(ways, legs);
  if (run.length === legs.length) return nonEmpty.length === sections.length ? sections : nonEmpty;
  const runStart = legs.findIndex(
    (leg, index) =>
      leg === run[0] && run.every((candidate, offset) => legs[index + offset] === candidate),
  );
  return runStart < 0 ? [] : sharedSectionsWithinRun(nonEmpty, runStart, run.length);
}

function runIsContinuous(waysById: Map<string, Way>, pattern: Pattern, run: RunDirection): boolean {
  const segments = patternRunSegments(waysById, pattern, run);
  if (segments.length === 0) return false;
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1].path;
    const next = segments[index].path;
    if (haversineMeters(previous[previous.length - 1], next[0]) > JOIN_TOLERANCE_M) return false;
  }
  return true;
}

type SplitSection = Extract<PatternSection, { kind: 'split' }>;

/** How far apart a couplet's two sides may sit where each end turns around.
 *
 * This is deliberately much wider than a leg join: the sides normally meet
 * around a block rather than at one exact point. It only rejects a pairing
 * measured in kilometres, where the surviving sides no longer describe the
 * same physical couplet. */
const SPLIT_FACING_TOLERANCE_M = 600;

function sectionRunPath(
  waysById: Map<string, Way>,
  pattern: Pattern,
  section: SplitSection,
  run: RunDirection,
): LngLat[] {
  const legs = new Set(run === 'outbound' ? section.outbound : section.inbound);
  return patternRunSegments(waysById, pattern, run)
    .filter((segment) => legs.has(segment.leg))
    .flatMap((segment) => segment.path);
}

/** Whether both ends of a split still describe the same physical couplet. */
export function splitSectionEndpointsAreCompatible(
  waysById: Map<string, Way>,
  pattern: Pattern,
  section: SplitSection,
): boolean {
  const outbound = sectionRunPath(waysById, pattern, section, 'outbound');
  const inbound = sectionRunPath(waysById, pattern, section, 'inbound');
  if (outbound.length < 2 || inbound.length < 2) return true;
  const far = haversineMeters(outbound[outbound.length - 1], inbound[0]);
  const near = haversineMeters(inbound[inbound.length - 1], outbound[0]);
  return Math.max(far, near) <= SPLIT_FACING_TOLERANCE_M;
}

function sectionsAreContinuous(waysById: Map<string, Way>, sections: PatternSection[]): boolean {
  const pattern: Pattern = { id: 'pattern-section-continuity-probe', sections };
  const runs: RunDirection[] = patternHasSplit(pattern) ? ['outbound', 'inbound'] : ['outbound'];
  return (
    runs.every((run) => runIsContinuous(waysById, pattern, run)) &&
    sections.every(
      (section) =>
        section.kind !== 'split' || splitSectionEndpointsAreCompatible(waysById, pattern, section),
    )
  );
}

function longestContinuousSectionRun(ways: Way[], sections: PatternSection[]): PatternSection[] {
  const waysById = wayById(ways);
  let longest: PatternSection[] = [];
  let longestMeters = -1;
  let run: PatternSection[] = [];
  let runMeters = 0;
  for (const section of sections) {
    const previous = run.at(-1);
    if (previous && !sectionsAreContinuous(waysById, [previous, section])) {
      run = [];
      runMeters = 0;
    }
    run.push(section);
    runMeters += patternSegments(waysById, {
      id: 'pattern-section-length-probe',
      sections: [section],
    }).reduce((total, segment) => total + pathLengthMeters(segment.path), 0);
    if ((run.length === 1 && !sectionsAreContinuous(waysById, run)) || runMeters <= longestMeters)
      continue;
    longest = run.slice();
    longestMeters = runMeters;
  }
  return longest.length === sections.length ? sections : longest;
}

/** Retain the physically longest fragment that stays continuous within and
 * across sections. */
export function longestContinuousPatternSections(
  ways: Way[],
  sections: PatternSection[],
): PatternSection[] {
  if (sections.every(isSharedSection)) return longestSharedSectionRun(ways, sections);
  const internallyContinuous = pruneSections(
    mapSectionLegs(sections, (legs) => longestContinuousLegRun(ways, legs)),
  );
  return longestContinuousSectionRun(ways, internallyContinuous);
}
