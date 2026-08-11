import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { CooperativeRenderJobUnitSequence } from '../../src/map/cooperative-render-job-scheduler';
import {
  createAcceptedSceneStore,
  type AcceptedSceneStore,
} from '../../src/map/accepted-scene-store';
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
} from '../../src/map/render-scene-source-updater';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from '../../src/map/system-feature-sources';

export { emptySystemFeatures } from '../../src/map/system-feature-sources';

export type SourceCall =
  | { method: 'setData'; data: FeatureCollection }
  | { method: 'updateData'; data: GeoJsonSourceUpdate };

export class RecordingSource implements GeoJsonSourceTarget {
  readonly calls: SourceCall[] = [];
  failNext = false;

  setData(data: FeatureCollection): void {
    this.record({ method: 'setData', data });
  }

  updateData(data: GeoJsonSourceUpdate): void {
    this.record({ method: 'updateData', data });
  }

  private record(call: SourceCall): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('source submission failed');
    }
    this.calls.push(call);
  }
}

export interface LineFeatureOptions {
  readonly renderTier?: 'overview' | 'district' | 'street';
  readonly hitTarget?: boolean;
}

export function lineFeature(
  id: string,
  domainId: string,
  x: number,
  options: LineFeatureOptions = {},
): Feature<LineString> {
  return {
    type: 'Feature',
    id,
    properties: {
      id: domainId,
      renderTier: options.renderTier ?? 'overview',
      hitTarget: options.hitTarget ?? false,
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [x, 0],
        [x + 1, 0],
      ],
    },
  };
}

export function pointFeature(
  id: string,
  domainProperty: 'id' | 'wayId',
  domainId: string,
  x: number,
): Feature<Point> {
  return {
    type: 'Feature',
    id,
    properties: { [domainProperty]: domainId },
    geometry: { type: 'Point', coordinates: [x, 0] },
  };
}

export interface ControllerFixture {
  readonly controller: AcceptedSceneStore;
  source(sourceId: SystemFeatureSourceId): RecordingSource;
  readonly hitSource: RecordingSource;
}

export function controllerFixture(): ControllerFixture {
  const sources = new Map<SystemFeatureSourceId, RecordingSource>(
    Object.values(SYSTEM_FEATURE_SOURCE_BY_NAME).map((sourceId) => [
      sourceId,
      new RecordingSource(),
    ]),
  );
  const hitSource = new RecordingSource();
  const source = (sourceId: SystemFeatureSourceId): RecordingSource => {
    const target = sources.get(sourceId);
    if (!target) throw new Error(`Missing source fixture: ${sourceId}`);
    return target;
  };
  return {
    controller: createAcceptedSceneStore({
      resolveSource: source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    }),
    source,
    hitSource,
  };
}

export interface ExecutedUnitStats {
  readonly ids: readonly string[];
  readonly maxDurationMs: number;
  readonly maxUnitId: string | null;
  readonly maxDescriptorDurationMs: number;
}

export function runUnits(units: CooperativeRenderJobUnitSequence<void>): ExecutedUnitStats {
  const ids: string[] = [];
  let maxDurationMs = 0;
  let maxUnitId: string | null = null;
  let maxDescriptorDurationMs = 0;
  for (let index = 0; ; index += 1) {
    const descriptorStartedAt = performance.now();
    const unit = units.unitAt(index);
    maxDescriptorDurationMs = Math.max(
      maxDescriptorDurationMs,
      performance.now() - descriptorStartedAt,
    );
    if (!unit) break;
    const startedAt = performance.now();
    unit.run();
    const durationMs = performance.now() - startedAt;
    if (durationMs > maxDurationMs) {
      maxDurationMs = durationMs;
      maxUnitId = unit.id;
    }
    ids.push(unit.id);
  }
  return { ids, maxDurationMs, maxUnitId, maxDescriptorDurationMs };
}
