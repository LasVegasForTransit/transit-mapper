// Unit system and formatting for distances, lengths, and speeds
// All internal storage uses metric (meters, km/h); conversions happen at display time

export type UnitSystem = 'metric' | 'imperial';

// Precise conversion constants (international feet and miles)
const METERS_TO_FEET = 3.28083989501312; // exactly 1/0.3048
const FEET_TO_METERS = 0.3048; // exactly 1 international foot
const KMH_TO_MPH = 0.62137119223733; // km/h to mph

/** Convert a stored metric dimension to the number an editable field shows. */
export function lengthFromMeters(meters: number, system: UnitSystem): number {
  return system === 'metric' ? meters : meters * METERS_TO_FEET;
}

/** Convert an edited dimension back to the metric value the model stores. */
export function lengthToMeters(value: number, system: UnitSystem): number {
  return system === 'metric' ? value : value * FEET_TO_METERS;
}

/** Convert a stored metric speed to the number an editable field shows. */
export function speedFromKmh(kmh: number, system: UnitSystem): number {
  return system === 'metric' ? kmh : kmh * KMH_TO_MPH;
}

/** Convert an edited speed back to the metric value the model stores. */
export function speedToKmh(value: number, system: UnitSystem): number {
  return system === 'metric' ? value : value / KMH_TO_MPH;
}

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
