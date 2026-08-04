export interface ProjectProvenance {
  developer: { name: string; url: string };
  coreContributors: Array<{ name: string; role: string }>;
  platformCredits: Array<{ label: string; url: string }>;
}

/** Editorial credits have no honest mechanical source. Keep the judgement in
 * this one list; the dialog renders it directly and Git history never gets to
 * promote a bot or infer somebody's organizational role. */
export const PROJECT_PROVENANCE: ProjectProvenance = {
  developer: {
    name: 'Las Vegans for Better Transit',
    url: 'https://lasvegasfortransit.org',
  },
  coreContributors: [
    {
      name: 'Willie Chalmers III',
      role: 'Lead, LVBT president',
    },
  ],
  platformCredits: [
    { label: 'MapLibre GL JS', url: 'https://maplibre.org/maplibre-gl-js/docs/' },
    { label: 'OpenFreeMap', url: 'https://openfreemap.org/' },
    {
      label: 'OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
    },
    { label: 'Public Sans', url: 'https://public-sans.digital.gov/' },
  ],
};
