// Unit system and formatting for distances, lengths, and speeds
// All internal storage uses metric (meters, km/h); conversions happen at display time

export type UnitSystem = 'metric' | 'imperial';

// Precise conversion constants (US survey feet and international mile)
const METERS_TO_FEET = 3.28083989501312; // exactly 10/0.3048
const FEET_TO_METERS = 0.3048; // exactly 1 foot
const KMH_TO_MPH = 0.62137119223733; // km/h to mph

// Format a distance in meters, returning a string with the appropriate unit
export function formatDistance(meters: number, system: UnitSystem): string {
  if (system === 'metric') {
    if (meters >= 1000) {
      const km = meters / 1000;
      return (
        new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(km) + ' km'
      );
    }
    return (
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(meters) + ' m'
    );
  }
  // imperial
  const miles = (meters * METERS_TO_FEET) / 5280;
  if (miles >= 0.1) {
    return (
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(miles) + ' mi'
    );
  }
  const feet = meters * METERS_TO_FEET;
  return (
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(feet) + ' ft'
  );
}

// Format a length (like vehicle width/length) in meters
export function formatLength(meters: number, system: UnitSystem): string {
  if (system === 'metric') {
    return (
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(meters) + ' m'
    );
  }
  // imperial
  const feet = meters * METERS_TO_FEET;
  return (
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(feet) + ' ft'
  );
}

// Format a speed in km/h
export function formatSpeed(kmh: number, system: UnitSystem): string {
  if (system === 'metric') {
    return (
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(kmh) + ' km/h'
    );
  }
  // imperial
  const mph = kmh * KMH_TO_MPH;
  return (
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(mph) + ' mph'
  );
}

// Format a scale bar distance in meters (for display on maps)
export function formatScaleBar(meters: number, system: UnitSystem): string {
  return formatDistance(meters, system);
}

// Get nice scale increments for a given number of meters, returning the increment and label
export function niceScaleMeters(
  meters: number,
  system: UnitSystem,
): { increment: number; label: string } {
  // For metric, nice increments are powers of 10: 1, 10, 100, 1000
  // For imperial, nice increments are in feet: 100, 500, 1000, 5280 (mile)
  if (system === 'metric') {
    const increments = [1, 10, 100, 1000, 10000];
    for (const inc of increments) {
      if (inc >= meters / 2) {
        return { increment: inc, label: formatDistance(inc, 'metric') };
      }
    }
    return { increment: 10000, label: formatDistance(10000, 'metric') };
  }

  // Imperial: feet-based increments
  const metersInFeet = meters * METERS_TO_FEET;
  const increments = [100, 500, 1000, 5280, 10560];
  for (const incFeet of increments) {
    if (incFeet >= metersInFeet / 2) {
      const incMeters = incFeet * FEET_TO_METERS;
      return {
        increment: incMeters,
        label: formatDistance(incMeters, 'imperial'),
      };
    }
  }
  const incMeters = 10560 * FEET_TO_METERS;
  return { increment: incMeters, label: formatDistance(incMeters, 'imperial') };
}

// Get the increment to use for a single step when adjusting a dimension in the given system
export function getIncrementForSystem(system: UnitSystem): number {
  // Metric: 0.1 meters, Imperial: 1 foot (0.3048 meters exactly)
  return system === 'metric' ? 0.1 : FEET_TO_METERS;
}
