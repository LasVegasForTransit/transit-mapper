export const messages = {
  settings: {
    title: 'Settings',
    description: 'Choose how distances, dimensions, and speeds are shown.',
    units: {
      label: 'Units',
      metric: 'Metric (km, m, km/h)',
      imperial: 'Imperial (mi, ft, mph)',
    },
  },
  vehicle: {
    widthMetric: 'm wide',
    widthImperial: 'ft wide',
    lengthMetric: 'm long',
    lengthImperial: 'ft long',
    speedMetric: 'km/h top speed',
    speedImperial: 'mph top speed',
  },
} as const;
