import type { Facility, Group, NamedWay, Node, Service, Station, Stop, Way } from '../model/system';
import type { PreparedServiceBundleDraft } from './render-preparation-bundles';
import type { MutablePreparedDependencyState } from './render-preparation-dependencies';
import type { RenderPreparationPlanBuilder } from './render-preparation-plan-builder';
import type { PlanRenderPreparationOptions } from './render-preparation-types';
import type {
  ColdPreparedViewportCategory,
  PreparedViewportDraft,
} from './render-preparation-viewport';
import type { RenderProjectionFullReason } from './render-projection-scope';
import type { RenderViewportCategory } from './viewport-index';

export interface ColdDomainDraft {
  readonly waysById: Map<string, Way>;
  readonly nodesById: Map<string, Node>;
  readonly servicesById: Map<string, Service>;
  readonly stopsById: Map<string, Stop>;
  readonly stationsById: Map<string, Station>;
  readonly namedWaysById: Map<string, NamedWay>;
  readonly facilitiesById: Map<string, Facility>;
  readonly groupsById: Map<string, Group>;
  readonly wayRank: Map<string, number>;
  readonly nodeRank: Map<string, number>;
  readonly stopRank: Map<string, number>;
  readonly stationRank: Map<string, number>;
  readonly modeIds: Set<string>;
  readonly wayTypeIds: Set<string>;
}

export interface AddColdPreparationPlanOptions {
  readonly builder: RenderPreparationPlanBuilder;
  readonly options: PlanRenderPreparationOptions;
  readonly categories: readonly RenderViewportCategory[];
  readonly generation: number;
  readonly chunkSize: number;
  readonly fullProjectionReason?: RenderProjectionFullReason;
}

export interface ColdPlanContext extends AddColdPreparationPlanOptions {
  readonly categorySet: ReadonlySet<RenderViewportCategory>;
  readonly domain: ColdDomainDraft;
  readonly dependency: MutablePreparedDependencyState;
  readonly viewport: PreparedViewportDraft;
  readonly coldViewport: ReadonlyMap<RenderViewportCategory, ColdPreparedViewportCategory>;
  readonly bundles: PreparedServiceBundleDraft;
}
