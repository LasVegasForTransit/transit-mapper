// Unit system and formatting for distances, lengths, and speeds
// All internal storage uses metric (meters, km/h); conversions happen at display time

export type UnitSystem = 'metric' | 'imperial';

// Precise conversion constants (international feet and miles)
const METERS_TO_FEET = 3.28083989501312; // exactly 1/0.3048
const FEET_TO_METERS = 0.3048; // exactly 1 international foot
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

// Get the increment to use for a single step when adjusting a dimension in the given system
export function getIncrementForSystem(system: UnitSystem): number {
  // Metric: 0.1 meters, Imperial: 1 foot (0.3048 meters exactly)
  return system === 'metric' ? 0.1 : FEET_TO_METERS;
}
