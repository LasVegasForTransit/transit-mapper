import { shortId } from '../ids';
import type { LngLat } from './valueTypes';

/** Bundles any objects into one unit: a transfer complex, a line family, a
 *  facility complex (bus bays, platforms, entrances grouped under one real
 *  physical site — see the Facility tool). */
export interface Group {
  id: string;
  name?: string;
  memberIds: string[];
  /** Physical boundary polygon, drawn in the infrastructure view — what
   *  turns a plain logical group into a facility complex with a real site. */
  footprint?: LngLat[];
  /** A facility complex's own color (distinguishes it from other complexes
   *  on the map) — hex, e.g. "#e4572e". Plain (footprint-less) groups don't
   *  need one. */
  color?: string;
}

/** A new group bundling `memberIds` (deduplicated) under `name` — the one
 *  place a bare Group literal gets constructed (see editor/store.ts's
 *  createGroup). */
export function createGroup(memberIds: string[], name?: string): Group {
  return { id: shortId(), name, memberIds: [...new Set(memberIds)] };
}

interface GroupDocument {
  groups: Group[];
}

/** Removes deleted record ids from every group while preserving untouched references. */
export function removeGroupMembers<System extends GroupDocument>(
  system: System,
  removedIds: ReadonlySet<string>,
): System {
  if (removedIds.size === 0) return system;
  if (!system.groups.some((group) => group.memberIds.some((id) => removedIds.has(id)))) {
    return system;
  }
  return {
    ...system,
    groups: system.groups.map((group) => {
      const memberIds = group.memberIds.filter((id) => !removedIds.has(id));
      return memberIds.length === group.memberIds.length ? group : { ...group, memberIds };
    }),
  };
}

function sameCoord(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function replaceGroup<System extends GroupDocument>(
  system: System,
  id: string,
  update: (group: Group) => Group,
): System {
  const index = system.groups.findIndex((group) => group.id === id);
  if (index < 0) return system;
  const current = system.groups[index];
  const group = update(current);
  if (group === current) return system;
  const groups = [...system.groups];
  groups[index] = group;
  return { ...system, groups };
}

export function addGroupMember<System extends GroupDocument>(
  system: System,
  groupId: string,
  memberId: string,
): System {
  return replaceGroup(system, groupId, (group) =>
    group.memberIds.includes(memberId)
      ? group
      : { ...group, memberIds: [...group.memberIds, memberId] },
  );
}

export function removeGroupMember<System extends GroupDocument>(
  system: System,
  groupId: string,
  memberId: string,
): System {
  return replaceGroup(system, groupId, (group) =>
    group.memberIds.includes(memberId)
      ? { ...group, memberIds: group.memberIds.filter((id) => id !== memberId) }
      : group,
  );
}

export function renameGroup<System extends GroupDocument>(
  system: System,
  id: string,
  name: string,
): System {
  return replaceGroup(system, id, (group) => (group.name === name ? group : { ...group, name }));
}

export function setGroupColor<System extends GroupDocument>(
  system: System,
  id: string,
  color: string | undefined,
): System {
  return replaceGroup(system, id, (group) => (group.color === color ? group : { ...group, color }));
}

export function deleteGroup<System extends GroupDocument>(system: System, id: string): System {
  const groups = system.groups.filter((group) => group.id !== id);
  return groups.length === system.groups.length ? system : { ...system, groups };
}

export function addGroupFootprint<System extends GroupDocument>(
  system: System,
  id: string,
  footprint: LngLat[],
): System {
  return replaceGroup(system, id, (group) => (group.footprint ? group : { ...group, footprint }));
}

export function moveGroupFootprintPoint<System extends GroupDocument>(
  system: System,
  id: string,
  index: number,
  coord: LngLat,
): System {
  return replaceGroup(system, id, (group) => {
    const point = group.footprint?.[index];
    if (!group.footprint || !point || sameCoord(point, coord)) return group;
    return {
      ...group,
      footprint: group.footprint.map((candidate, candidateIndex) =>
        candidateIndex === index ? coord : candidate,
      ),
    };
  });
}

export function deleteGroupFootprint<System extends GroupDocument>(
  system: System,
  id: string,
): System {
  return replaceGroup(system, id, (group) =>
    group.footprint ? { ...group, footprint: undefined } : group,
  );
}
