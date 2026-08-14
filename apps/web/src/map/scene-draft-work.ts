/**
 * Small resumable cursors used while constructing a scene draft.
 *
 * They deliberately know nothing about documents, sources, or MapLibre. Their
 * only job is to turn collection, geometry-stat, and merge work into bounded
 * pieces that the renderer scheduler can yield between.
 */
import type { Geometry } from 'geojson';

/**
 * A side-effect-free piece of draft construction.
 *
 * The scheduler runs these between frames. Keeping the work vocabulary here
 * lets geometry statistics, merge cursors, and source preparation share it
 * without importing the higher-level draft result or publication contracts.
 */
export interface SceneDraftWorkUnit {
  readonly id: string;
  run(): void;
}

interface GeometryFrame {
  readonly kind: 'geometry';
  readonly geometry: Geometry;
}

interface PartFrame {
  readonly kind: 'parts';
  readonly parts: readonly (readonly unknown[])[];
  index: number;
}

interface PolygonFrame {
  readonly kind: 'polygons';
  readonly polygons: readonly (readonly (readonly unknown[])[])[];
  polygonIndex: number;
  ringIndex: number;
}

interface GeometryCollectionFrame {
  readonly kind: 'geometries';
  readonly geometries: readonly Geometry[];
  index: number;
}

type VertexCountFrame = GeometryFrame | PartFrame | PolygonFrame | GeometryCollectionFrame;

export interface ResumableGeometryVertexCountOptions {
  readonly id: string;
  readonly geometry: Geometry;
  readonly stepsPerUnit: number;
}

/** Counts GeoJSON vertices by array lengths while yielding between aggregate
 * parts. Individual coordinate positions remain O(1) for LineString/Polygon
 * rings, while Multi* and GeometryCollection breadth is explicitly bounded. */
export class ResumableGeometryVertexCount {
  private readonly frames: VertexCountFrame[];
  private vertexCount = 0;
  private complete = false;
  private unitIndex = 0;

  constructor(private readonly options: ResumableGeometryVertexCountOptions) {
    if (!Number.isSafeInteger(options.stepsPerUnit) || options.stepsPerUnit < 1) {
      throw new RangeError('Geometry stats steps per unit must be a positive integer.');
    }
    this.frames = [{ kind: 'geometry', geometry: options.geometry }];
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    if (this.complete) return undefined;
    const unitIndex = this.unitIndex++;
    return {
      id: `${this.options.id}:stats:${unitIndex}`,
      run: () => this.runSteps(),
    };
  }

  result(): number {
    if (!this.complete) {
      throw new Error(`Geometry stats are incomplete: ${this.options.id}`);
    }
    return this.vertexCount;
  }

  private runSteps(): void {
    for (let step = 0; step < this.options.stepsPerUnit; step += 1) {
      const frame = this.frames.pop();
      if (!frame) {
        this.complete = true;
        return;
      }
      this.visit(frame);
    }
    if (this.frames.length === 0) this.complete = true;
  }

  private visit(frame: VertexCountFrame): void {
    switch (frame.kind) {
      case 'geometry':
        this.visitGeometry(frame.geometry);
        return;
      case 'parts':
        this.visitParts(frame);
        return;
      case 'polygons':
        this.visitPolygons(frame);
        return;
      case 'geometries':
        this.visitGeometries(frame);
    }
  }

  private visitGeometry(geometry: Geometry): void {
    switch (geometry.type) {
      case 'Point':
        this.vertexCount += 1;
        return;
      case 'MultiPoint':
      case 'LineString':
        this.vertexCount += geometry.coordinates.length;
        return;
      case 'MultiLineString':
      case 'Polygon':
        this.frames.push({ kind: 'parts', parts: geometry.coordinates, index: 0 });
        return;
      case 'MultiPolygon':
        this.frames.push({
          kind: 'polygons',
          polygons: geometry.coordinates,
          polygonIndex: 0,
          ringIndex: 0,
        });
        return;
      case 'GeometryCollection':
        this.frames.push({ kind: 'geometries', geometries: geometry.geometries, index: 0 });
    }
  }

  private visitParts(frame: PartFrame): void {
    if (frame.index >= frame.parts.length) return;
    const part = frame.parts[frame.index];
    frame.index += 1;
    this.vertexCount += part.length;
    this.frames.push(frame);
  }

  private visitPolygons(frame: PolygonFrame): void {
    if (frame.polygonIndex >= frame.polygons.length) return;
    const polygon = frame.polygons[frame.polygonIndex];
    if (frame.ringIndex >= polygon.length) {
      frame.polygonIndex += 1;
      frame.ringIndex = 0;
      this.frames.push(frame);
      return;
    }
    const ring = polygon[frame.ringIndex];
    frame.ringIndex += 1;
    this.vertexCount += ring.length;
    this.frames.push(frame);
  }

  private visitGeometries(frame: GeometryCollectionFrame): void {
    if (frame.index >= frame.geometries.length) return;
    const geometry = frame.geometries[frame.index];
    frame.index += 1;
    this.frames.push(frame, { kind: 'geometry', geometry });
  }
}

interface RunCursor<Value> {
  readonly run: readonly Value[];
  readonly runIndex: number;
  offset: number;
}

class MinHeap<Value> {
  private readonly values: RunCursor<Value>[] = [];

  constructor(private readonly compare: (left: Value, right: Value) => number) {}

  get size(): number {
    return this.values.length;
  }

  push(cursor: RunCursor<Value>): void {
    this.values.push(cursor);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): RunCursor<Value> {
    if (this.values.length === 0) throw new Error('Cannot pop an empty renderer merge heap.');
    const lastIndex = this.values.length - 1;
    const first = this.values[0];
    const last = this.values[lastIndex];
    this.values.length = lastIndex;
    if (lastIndex === 0) return first;
    this.values[0] = last;
    this.bubbleDown(0);
    return first;
  }

  private cursorOrder(left: RunCursor<Value>, right: RunCursor<Value>): number {
    return (
      this.compare(left.run[left.offset], right.run[right.offset]) || left.runIndex - right.runIndex
    );
  }

  private bubbleUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.cursorOrder(this.values[parent], this.values[index]) <= 0) return;
      const parentValue = this.values[parent];
      this.values[parent] = this.values[index];
      this.values[index] = parentValue;
      index = parent;
    }
  }

  private bubbleDown(start: number): void {
    let index = start;
    do {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.values.length &&
        this.cursorOrder(this.values[left], this.values[smallest]) < 0
      ) {
        smallest = left;
      }
      if (
        right < this.values.length &&
        this.cursorOrder(this.values[right], this.values[smallest]) < 0
      ) {
        smallest = right;
      }
      if (smallest === index) return;
      const current = this.values[index];
      this.values[index] = this.values[smallest];
      this.values[smallest] = current;
      index = smallest;
    } while (index < this.values.length);
  }
}

export interface SortedRunMergeOptions<Value> {
  readonly id: string;
  readonly runs: readonly (readonly Value[])[];
  readonly compare: (left: Value, right: Value) => number;
  readonly batchSize: number;
  readonly unique?: boolean;
}

export class SortedRunMerge<Value> {
  private readonly heap: MinHeap<Value>;
  private readonly output: Value[] = [];
  private initializedRunCount = 0;
  private complete = false;

  constructor(private readonly options: SortedRunMergeOptions<Value>) {
    this.heap = new MinHeap(options.compare);
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    if (this.complete) return undefined;
    if (this.initializedRunCount < this.options.runs.length) return this.initializeWork();
    if (this.heap.size > 0) return this.mergeWork();
    this.complete = true;
    return undefined;
  }

  result(): Value[] {
    if (!this.complete) throw new Error(`Sorted run merge is incomplete: ${this.options.id}`);
    return this.output;
  }

  private initializeWork(): SceneDraftWorkUnit {
    const start = this.initializedRunCount;
    const end = Math.min(start + this.options.batchSize, this.options.runs.length);
    return {
      id: `${this.options.id}:initialize:${start}`,
      run: () => {
        for (let runIndex = start; runIndex < end; runIndex += 1) {
          const run = this.options.runs[runIndex];
          if (run.length > 0) this.heap.push({ run, runIndex, offset: 0 });
        }
        this.initializedRunCount = end;
      },
    };
  }

  private mergeWork(): SceneDraftWorkUnit {
    const start = this.output.length;
    return {
      id: `${this.options.id}:merge:${start}`,
      run: () => {
        let visited = 0;
        while (visited < this.options.batchSize && this.heap.size > 0) {
          const cursor = this.heap.pop();
          const value = cursor.run[cursor.offset];
          if (this.options.unique !== true || this.output.at(-1) !== value) {
            this.output.push(value);
          }
          cursor.offset += 1;
          if (cursor.offset < cursor.run.length) this.heap.push(cursor);
          visited += 1;
        }
      },
    };
  }
}
