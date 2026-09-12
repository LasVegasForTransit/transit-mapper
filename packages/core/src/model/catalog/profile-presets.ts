import { FT } from './lane-kinds';
import type { ProfileTemplateLane } from './way-types';
// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// ---- Profile presets --------------------------------------------------------
// One-click cross-sections offered when drawing or editing a way — "pick a
// preset and drag" is the turnkey path; the lane editor refines from there.

export interface ProfilePreset {
  id: string;
  label: string;
  wayTypeId: string;
  /** Facility class a way gets when this preset is applied, if any. */
  classId?: string;
  lanes: ProfileTemplateLane[];
}

const SIDEWALK: ProfileTemplateLane = { kindId: 'sidewalk', direction: 'both' };
const DRIVE_F: ProfileTemplateLane = { kindId: 'drive', direction: 'forward' };
const DRIVE_B: ProfileTemplateLane = { kindId: 'drive', direction: 'backward' };

export const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  roadLocal2: {
    id: 'roadLocal2',
    label: '2-lane local',
    wayTypeId: 'road',
    classId: 'local',
    lanes: [
      SIDEWALK,
      { kindId: 'parking', direction: 'none' },
      DRIVE_B,
      DRIVE_F,
      { kindId: 'parking', direction: 'none' },
      SIDEWALK,
    ],
  },
  roadCollector3: {
    id: 'roadCollector3',
    label: '3-lane w/ center turn',
    wayTypeId: 'road',
    classId: 'collector',
    lanes: [
      SIDEWALK,
      { kindId: 'bike', direction: 'backward' },
      DRIVE_B,
      { kindId: 'turnPocket', direction: 'both' },
      DRIVE_F,
      { kindId: 'bike', direction: 'forward' },
      SIDEWALK,
    ],
  },
  roadArterial4: {
    id: 'roadArterial4',
    label: '4-lane arterial',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [SIDEWALK, DRIVE_B, DRIVE_B, DRIVE_F, DRIVE_F, SIDEWALK],
  },
  roadArterial5: {
    id: 'roadArterial5',
    label: '5-lane w/ center turn',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      DRIVE_B,
      DRIVE_B,
      { kindId: 'turnPocket', direction: 'both' },
      DRIVE_F,
      DRIVE_F,
      SIDEWALK,
    ],
  },
  roadBoulevard: {
    id: 'roadBoulevard',
    label: 'Divided boulevard',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      { kindId: 'bike', direction: 'backward' },
      DRIVE_B,
      DRIVE_B,
      { kindId: 'median', direction: 'none', widthM: 16 * FT },
      DRIVE_F,
      DRIVE_F,
      { kindId: 'bike', direction: 'forward' },
      SIDEWALK,
    ],
  },
  roadOneWay3: {
    id: 'roadOneWay3',
    label: '3-lane one-way',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      { kindId: 'parking', direction: 'none' },
      DRIVE_F,
      DRIVE_F,
      DRIVE_F,
      SIDEWALK,
    ],
  },
  roadTransitway: {
    id: 'roadTransitway',
    label: 'Transitway',
    wayTypeId: 'road',
    classId: 'transitway',
    lanes: [
      SIDEWALK,
      { kindId: 'bus', direction: 'backward' },
      { kindId: 'bus', direction: 'forward' },
      SIDEWALK,
    ],
  },
  railSingle: {
    id: 'railSingle',
    label: 'Single track',
    wayTypeId: 'heavyRail',
    lanes: [{ kindId: 'track', direction: 'both' }],
  },
  railDouble: {
    id: 'railDouble',
    label: 'Double track',
    wayTypeId: 'heavyRail',
    lanes: [
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'forward' },
    ],
  },
  railQuad: {
    id: 'railQuad',
    label: 'Quad track',
    wayTypeId: 'heavyRail',
    lanes: [
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'forward' },
      { kindId: 'track', direction: 'forward' },
    ],
  },
};

export const PROFILE_PRESET_ORDER: string[] = [
  'roadLocal2',
  'roadCollector3',
  'roadArterial4',
  'roadArterial5',
  'roadBoulevard',
  'roadOneWay3',
  'roadTransitway',
  'railSingle',
  'railDouble',
  'railQuad',
];

/** Presets for a way type, in catalog order. */
export function profilePresetsForWayType(typeId: string): ProfilePreset[] {
  return PROFILE_PRESET_ORDER.map((id) => PROFILE_PRESETS[id]).filter(
    (p) => p.wayTypeId === typeId,
  );
}
