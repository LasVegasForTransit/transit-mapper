import type { DetailBand } from '../query';

/** What a query's detail band asks the chunk to carry.
 *
 * A band is not a request. `queryDetailBand` derives it from the camera using
 * the measure the renderer uses for paint detail — the displayed width of a
 * default road corridor — so it states what a person can resolve at this
 * scale, and nothing more. It may therefore narrow physical detail only.
 *
 * Every transit fact is band-independent: Lines, ServicePlans, Patterns,
 * Stops, Stations, stop calls, topology windows, and the Pattern-leg
 * geometry a Line paints are identical across bands for one bounds. That is
 * what lets a person cross a band boundary while panning without the map
 * deciding a Line has stopped existing or has moved.
 *
 * Two candidates deliberately narrow nothing:
 *
 * Stops and Stations stay whole. The UX contract does hide ordinary Stop
 * detail at overview, but that is a paint rule: a Stop named by a retained
 * call has to reach the renderer, because `line-topology-window-validation`
 * rejects a whole topology window whose call resolves to no Stop, and a
 * rejected window costs the Line its geometry. Dropping only the unserved
 * residue would buy nothing at region scale, where every Pattern is visible
 * and so nearly every Stop is called.
 *
 * The physical Way set the selection runs on stays whole as well. Narrowing
 * `boundedPhysicalWayIds` would change which ServicePlans are candidates,
 * and therefore which Lines the chunk holds — a Line's identity would then
 * depend on the zoom it was resolved at. Only what the chunk *emits* narrows.
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
