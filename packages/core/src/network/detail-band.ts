import type { DetailBand } from './query';

/** What a query's detail band asks the chunk to carry.
 *
 * `queryDetailBand` derives the band from the camera, so it states what a
 * person can resolve at this scale and may narrow physical detail only. Every
 * transit fact — Lines, ServicePlans, Patterns, Stops, Stations, stop calls,
 * topology windows, Pattern-leg geometry — is identical across bands for one
 * bounds, so panning across a band boundary never makes a Line appear to move
 * or vanish.
 *
 * Two things deliberately narrow nothing. Stops and Stations stay whole
 * because `line-topology-window-validation` rejects a window whose call
 * resolves to no Stop, and a rejected window costs the Line its geometry.
 * `boundedPhysicalWayIds` stays whole because narrowing it would change which
 * Lines the chunk holds, making a Line's identity depend on its zoom. Only
 * what the chunk emits narrows.
 */
export interface DetailBandContent {
  /** The street network as a thing in its own right: Ways lying in the query
   * bounds that carry no selected Pattern, the carrier geometry cut from
   * them, and the Nodes joining them. A default road corridor is under two
   * displayed pixels wide at overview, so none of it is drawable there, and a
   * region-wide viewport is exactly where there is most of it. Ways that
   * carry a Pattern arrive through the fragment closure regardless of band. */
  readonly streetNetwork: boolean;
  /** What happens inside one carriageway or at one junction approach: lane
   * connectors, turn restrictions, approach controls, and medians. A lane
   * only separates from its corridor once that corridor is at least twelve
   * displayed pixels wide, which is the threshold that defines street. */
  readonly carriagewayDetail: boolean;
}

export function detailBandContent(band: DetailBand): DetailBandContent {
  return { streetNetwork: band !== 'overview', carriagewayDetail: band === 'street' };
}
