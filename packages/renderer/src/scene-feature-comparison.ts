import type { RenderFeature } from '@transitmapper/core/render/render-scene';
/**
 * Resumable structural equality for same-ID render features.
 *
 * Stable IDs say which feature may be replaced; they do not say whether a
 * freshly allocated geometry actually changed. This cursor compares nested
 * GeoJSON without recursively walking a huge feature in one task.
 */
import type { SceneDraftWorkUnit } from './scene-draft-types';

interface PairFrame {
  readonly kind: 'pair';
  readonly left: unknown;
  readonly right: unknown;
}

interface ArrayFrame {
  readonly kind: 'array';
  readonly left: readonly unknown[];
  readonly right: readonly unknown[];
  index: number;
}

interface RecordFrame {
  readonly kind: 'record';
  readonly left: Record<string, unknown>;
  readonly right: Record<string, unknown>;
  readonly leftKeys: IterableIterator<string>;
  readonly rightKeys: IterableIterator<string>;
  readonly expectedKeys: Set<string>;
  phase: 'left' | 'right';
  rightKeyCount: number;
}

interface ExitFrame {
  readonly kind: 'exit';
  readonly left: object;
  readonly right: object;
}

type ComparisonFrame = PairFrame | ArrayFrame | RecordFrame | ExitFrame;

function pair(left: unknown, right: unknown): PairFrame {
  return { kind: 'pair', left, right };
}

function enumerableKeys(record: Record<string, unknown>): IterableIterator<string> {
  return (function* keys() {
    for (const key in record) yield key;
  })();
}

export interface ResumableRenderFeatureComparisonOptions {
  readonly id: string;
  readonly previous: RenderFeature;
  readonly next: RenderFeature;
  readonly stepsPerUnit: number;
  recordUnit?(stepCount: number): void;
}

/** Exact structural equality whose array traversal is resumable. GeoJSON path
 * arrays can contain hundreds of thousands of positions, so one stable-ID
 * feature comparison must not become one indivisible renderer unit. */
export class ResumableRenderFeatureComparison {
  private readonly frames: ComparisonFrame[];
  private complete = false;
  private equal = true;
  private unitIndex = 0;
  private readonly activeLeft = new WeakSet();
  private readonly activeRight = new WeakSet();

  constructor(private readonly options: ResumableRenderFeatureComparisonOptions) {
    const { previous, next } = options;
    this.frames = [
      pair(previous.bbox, next.bbox),
      pair(previous.properties, next.properties),
      pair(previous.geometry, next.geometry),
      pair(previous.id, next.id),
    ];
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    if (this.complete) return undefined;
    const unitIndex = this.unitIndex++;
    return {
      id: `${this.options.id}:${unitIndex}`,
      run: () => {
        const stepCount = this.compareSteps();
        this.options.recordUnit?.(stepCount);
      },
    };
  }

  result(): boolean {
    if (!this.complete) {
      throw new Error(`Renderer feature comparison is incomplete: ${this.options.id}`);
    }
    return this.equal;
  }

  private compareSteps(): number {
    let completedSteps = 0;
    for (; completedSteps < this.options.stepsPerUnit && this.equal; completedSteps += 1) {
      const frame = this.frames.pop();
      if (!frame) {
        this.complete = true;
        return completedSteps;
      }
      this.compareFrame(frame);
    }
    if (!this.equal || this.frames.length === 0) this.complete = true;
    return completedSteps;
  }

  private compareFrame(frame: ComparisonFrame): void {
    switch (frame.kind) {
      case 'pair':
        this.comparePair(frame.left, frame.right);
        return;
      case 'array':
        this.compareArray(frame);
        return;
      case 'record':
        this.compareRecord(frame);
        return;
      case 'exit':
        this.activeLeft.delete(frame.left);
        this.activeRight.delete(frame.right);
    }
  }

  private comparePair(left: unknown, right: unknown): void {
    if (left === right) return;
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || left.length !== right.length) {
        this.equal = false;
        return;
      }
      this.enterContainers(left, right);
      this.frames.push({ kind: 'exit', left, right }, { kind: 'array', left, right, index: 0 });
      return;
    }
    if (Array.isArray(right)) {
      this.equal = false;
      return;
    }
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      this.enterContainers(leftRecord, rightRecord);
      this.frames.push(
        { kind: 'exit', left: leftRecord, right: rightRecord },
        {
          kind: 'record',
          left: leftRecord,
          right: rightRecord,
          leftKeys: enumerableKeys(leftRecord),
          rightKeys: enumerableKeys(rightRecord),
          expectedKeys: new Set(),
          phase: 'left',
          rightKeyCount: 0,
        },
      );
      return;
    }
    this.equal = false;
  }

  private enterContainers(left: object, right: object): void {
    if (this.activeLeft.has(left) || this.activeRight.has(right)) {
      throw new TypeError('Renderer feature comparison requires acyclic JSON-like values.');
    }
    this.activeLeft.add(left);
    this.activeRight.add(right);
  }

  private compareArray(frame: ArrayFrame): void {
    if (frame.index >= frame.left.length) return;
    const index = frame.index;
    frame.index += 1;
    this.frames.push(frame, pair(frame.left[index], frame.right[index]));
  }

  private compareRecord(frame: RecordFrame): void {
    if (frame.phase === 'left') {
      const key = frame.leftKeys.next();
      if (key.done) {
        frame.phase = 'right';
        this.frames.push(frame);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(frame.left, key.value)) {
        frame.expectedKeys.add(key.value);
      }
      this.frames.push(frame);
      return;
    }
    const key = frame.rightKeys.next();
    if (key.done) {
      if (frame.rightKeyCount !== frame.expectedKeys.size) this.equal = false;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(frame.right, key.value)) {
      this.frames.push(frame);
      return;
    }
    if (!frame.expectedKeys.has(key.value)) {
      this.equal = false;
      return;
    }
    frame.rightKeyCount += 1;
    this.frames.push(frame, pair(frame.left[key.value], frame.right[key.value]));
  }
}
