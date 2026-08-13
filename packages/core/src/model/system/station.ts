import type { LngLat } from './valueTypes';

/** A platform's physical geometry inside a Station (Infrastructure view). */
export interface Platform {
  id: string;
  points: LngLat[];
  /** Number of platform edges that board (1 = side, 2 = island). */
  edges?: number;
}

/** An optional named passenger place containing one or more physical Stops. */
export interface Station {
  id: string;
  name?: string;
  /** Focus and label position for the passenger place. */
  coord: LngLat;
  /** Physical boundary polygon, drawn in Infrastructure. */
  footprint?: LngLat[];
  /** Legacy station-scale platform geometry. Stops remain the boarding points. */
  platforms?: Platform[];
}
