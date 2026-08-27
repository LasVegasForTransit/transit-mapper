/**
 * Counts geometry for one normalized source without blocking on a huge feature.
 *
 * Scene drafting needs feature and vertex totals for diagnostics and scoped
 * updates. This cursor owns that accounting so source normalization can focus
 * on identity, ownership, and paint order.
 */
import type { RenderFeatureId } from '@transitmapper/core/render/render-identity';
import type {
  RenderFeature,
  RenderFeatureCollection,
} from '@transitmapper/core/render/render-scene';
import type { SceneDraftWorkUnit } from './scene-draft-types';
import { ResumableGeometryVertexCount } from './scene-draft-work';
import type { SourceFeatureStats } from './sources/scene-source-state';

export interface SceneFeatureStatsResult {
  readonly stats: SourceFeatureStats;
  readonly vertexCountByFeatureId: ReadonlyMap<RenderFeatureId, number>;
}

interface SceneFeatureStatsOptions {
  readonly sourceId: string;
  readonly visual: RenderFeatureCollection['features'];
  readonly hits: RenderFeatureCollection['features'];
  readonly batchSize: number;
}

function emptySourceStats(): SourceFeatureStats {
  return {
    visualFeatureCount: 0,
    visualVertexCount: 0,
    hitFeatureCount: 0,
    hitVertexCount: 0,
  };
}

export class SceneFeatureStats {
  private readonly stats = emptySourceStats();
  private readonly vertexCountByFeatureId = new Map<RenderFeatureId, number>();
  private offset = 0;
  private current: ResumableGeometryVertexCount | null = null;

  constructor(private readonly options: SceneFeatureStatsOptions) {}

  nextWork(): SceneDraftWorkUnit | undefined {
    if (this.current) {
      const work = this.current.nextWork();
      if (work) return work;
      this.retainCount(this.current.result());
    }
    if (this.offset >= this.featureCount()) return undefined;
    this.current = new ResumableGeometryVertexCount({
      id: `scene-draft:${this.options.sourceId}:${this.offset}`,
      geometry: this.featureAt(this.offset).geometry,
      stepsPerUnit: 512 * this.options.batchSize,
    });
    return this.nextWork();
  }

  result(): SceneFeatureStatsResult {
    if (this.current || this.offset < this.featureCount()) {
      throw new Error('Scene feature statistics are incomplete.');
    }
    return { stats: this.stats, vertexCountByFeatureId: this.vertexCountByFeatureId };
  }

  private retainCount(vertexCount: number): void {
    const feature = this.featureAt(this.offset);
    this.vertexCountByFeatureId.set(feature.id, vertexCount);
    if (this.offset < this.options.visual.length) {
      this.stats.visualFeatureCount += 1;
      this.stats.visualVertexCount += vertexCount;
    } else {
      this.stats.hitFeatureCount += 1;
      this.stats.hitVertexCount += vertexCount;
    }
    this.current = null;
    this.offset += 1;
  }

  private featureCount(): number {
    return this.options.visual.length + this.options.hits.length;
  }

  private featureAt(index: number): RenderFeature {
    return index < this.options.visual.length
      ? this.options.visual[index]
      : this.options.hits[index - this.options.visual.length];
  }
}
