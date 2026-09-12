// The single source of *kinds* in the app. Everything the model, tools, and
// inspector know about way types, service modes, grades, and facility
// classes lives here as DATA — not as union types baked into logic. This is
// pure domain data: what exists, what's compatible with what, what it's
// measured in. How it's drawn is a separate concern — see style/catalogStyle.ts.
//
// Adding a new way type (monorail guideway, gondola span, ferry route) or a new
// mode (funicular, trolleybus) is a catalog entry here, never a type or switch
// change elsewhere. Records in system.ts reference these by string id.

// The catalog is split by family so no one file carries all of it. Everything
// is re-exported here, so an importer names `model/catalog` and never has to
// know which family a kind belongs to.
export * from './catalog/from-catalog';
export * from './catalog/lane-kinds';
export * from './catalog/way-types';
export * from './catalog/profile-presets';
export * from './catalog/modes';
export * from './catalog/facility-types';

// ---- Grade -----------------------------------------------------------------
// Vertical alignment of a way: below ground, at grade, or elevated.

export type Grade = 'underground' | 'atGrade' | 'elevated';

export interface GradeInfo {
  label: string;
}

export const GRADES: Record<Grade, GradeInfo> = {
  underground: { label: 'Underground' },
  atGrade: { label: 'At grade' },
  elevated: { label: 'Elevated' },
};

export const GRADE_ORDER: Grade[] = ['underground', 'atGrade', 'elevated'];

// Default colors offered when seeding a new system's line palette. Lives here
// (not in the web app's style module) because serialize.ts's createEmptySystem
// needs it — a domain module can't reach into presentation code.
export const LINE_COLORS: string[] = [
  '#e4572e',
  '#2e86e4',
  '#2ea44f',
  '#8b5cf6',
  '#f59e0b',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#dc2626',
  '#4f46e5',
];
