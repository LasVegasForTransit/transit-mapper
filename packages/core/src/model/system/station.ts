import type { Platform } from './stop';
import type { LngLat } from './valueTypes';

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
