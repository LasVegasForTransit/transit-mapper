// User-facing strings for the application
// Future: integrate with a proper i18n library (react-intl, i18next, etc.)

export const messages = {
  settings: {
    title: 'Settings',
    description: 'Adjust app preferences',
    units: {
      label: 'Units',
      metric: 'Metric (km, m, km/h)',
      imperial: 'Imperial (mi, ft, mph)',
    },
  },
  units: {
    distance: {
      km: 'km',
      mi: 'mi',
      m: 'm',
      ft: 'ft',
    },
    speed: {
      kmh: 'km/h',
      mph: 'mph',
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
