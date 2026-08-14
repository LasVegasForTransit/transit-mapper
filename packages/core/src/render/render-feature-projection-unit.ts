/** Execution-only candidate boundaries for one resumable projection unit.
 *
 * This is deliberately separate from `RenderProjectionScope`: the latter
 * describes which domain owners changed, while this contract only divides an
 * already-authoritative projection into bounded work. Every supplied list is
 * an additional restriction; it can never widen viewport or dependency-scope
 * candidates. An empty list therefore means "visit/output none". */
export interface RenderFeatureProjectionUnitScope {
  readonly topologyWayIds?: readonly string[];
  readonly physicalWayIds?: readonly string[];
  readonly serviceWayIds?: readonly string[];
  readonly geometryNodeIds?: readonly string[];
  readonly junctionOutputNodeIds?: readonly string[];
  readonly connectorOutputNodeIds?: readonly string[];
  /** Boarding-point marker owners, distinct from physical stations. */
  readonly stopIds?: readonly string[];
  /** Physical passenger-place owners for footprints, platforms, and handles. */
  readonly stationIds?: readonly string[];
  readonly serviceIds?: readonly string[];
  readonly wayHandleIds?: readonly string[];
  readonly serviceTerminusIds?: readonly string[];
  readonly physicalHandleIds?: readonly string[];
  readonly namedWayIds?: readonly string[];
  readonly labelDependencyIds?: readonly string[];
  readonly labelWayIds?: readonly string[];
  readonly facilityIds?: readonly string[];
  readonly groupIds?: readonly string[];
}
