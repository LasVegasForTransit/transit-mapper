import type {
  RenderDomainIdentity,
  RenderFeatureId,
} from '@transitmapper/core/render/render-identity';
import type { IncrementalSourceState } from './scene-source-state';
import { overlayReadonlyMap } from './persistent-render-source-state';
import type { SceneDraftWorkUnit } from './scene-draft-types';

export interface ScopedSourceIndexes {
  readonly domains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  readonly visualDomains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  readonly domainsByFeature: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>;
}

export interface ScopedIndexBuilderOptions {
  readonly previous: IncrementalSourceState;
  readonly partial: IncrementalSourceState;
  readonly replacedFeatureIds: ReadonlySet<RenderFeatureId>;
  readonly affectedDomains: ReadonlySet<RenderDomainIdentity>;
  readonly batchSize: number;
}

type IndexPhase =
  'domains' | 'visual-domains' | 'remove-feature-domains' | 'add-feature-domains' | 'complete';

function sameFeatureIds(
  left: readonly RenderFeatureId[] | undefined,
  right: readonly RenderFeatureId[],
): boolean {
  return (
    left?.length === right.length && left.every((featureId, index) => featureId === right[index])
  );
}

/** Applies one bounded delta at a time. The resulting persistent maps retain
 * unrelated entries by identity without copying the complete source index. */
export class ScopedIndexBuilder {
  private phase: IndexPhase = 'domains';
  private affectedIterator: SetIterator<RenderDomainIdentity> | null = null;
  private affectedComplete = false;
  private affectedOffset = 0;
  private removedIterator: SetIterator<RenderFeatureId> | null = null;
  private removedComplete = false;
  private partialIterator: MapIterator<[RenderFeatureId, readonly RenderDomainIdentity[]]> | null =
    null;
  private partialComplete = false;
  private featureOffset = 0;
  private domains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  private visualDomains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  private domainsByFeature: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>;

  constructor(private readonly options: ScopedIndexBuilderOptions) {
    this.domains = options.previous.domains;
    this.visualDomains = options.previous.visualDomains;
    this.domainsByFeature = options.previous.domainsByFeature;
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'domains':
        return this.nextDomainMerge(false);
      case 'visual-domains':
        return this.nextDomainMerge(true);
      case 'remove-feature-domains':
        return this.nextFeatureRemoval();
      case 'add-feature-domains':
        return this.nextFeatureAddition();
      case 'complete':
        return undefined;
    }
  }

  result(): ScopedSourceIndexes {
    if (this.phase !== 'complete') throw new Error('Scoped renderer indexes are incomplete.');
    return {
      domains: this.domains,
      visualDomains: this.visualDomains,
      domainsByFeature: this.domainsByFeature,
    };
  }

  private nextDomainMerge(visual: boolean): SceneDraftWorkUnit | undefined {
    if (this.affectedComplete) {
      this.affectedIterator = null;
      this.affectedComplete = false;
      this.affectedOffset = 0;
      this.phase = visual ? 'remove-feature-domains' : 'visual-domains';
      return this.nextWork();
    }
    this.affectedIterator ??= this.options.affectedDomains.values();
    const label = visual ? 'visual-domains' : 'domains';
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:${label}:${this.affectedOffset}`,
      run: () => this.mergeDomainBatch(visual),
    };
  }

  private mergeDomainBatch(visual: boolean): void {
    const updates = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();
    const removals = new Set<RenderDomainIdentity>();
    for (let count = 0; count < this.options.batchSize; count += 1) {
      const entry = this.affectedIterator?.next();
      if (!entry || entry.done) {
        this.affectedComplete = true;
        break;
      }
      this.mergeOneDomain(entry.value, visual, updates, removals);
      this.affectedOffset += 1;
    }
    if (visual) this.visualDomains = overlayReadonlyMap(this.visualDomains, updates, removals);
    else this.domains = overlayReadonlyMap(this.domains, updates, removals);
  }

  private mergeOneDomain(
    domain: RenderDomainIdentity,
    visual: boolean,
    updates: Map<RenderDomainIdentity, readonly RenderFeatureId[]>,
    removals: Set<RenderDomainIdentity>,
  ): void {
    const previous = visual ? this.options.previous.visualDomains : this.options.previous.domains;
    const partial = visual ? this.options.partial.visualDomains : this.options.partial.domains;
    const featureIds = [
      ...(previous.get(domain) ?? []).filter(
        (featureId) => !this.options.replacedFeatureIds.has(featureId),
      ),
      ...(partial.get(domain) ?? []),
    ];
    const canonical = [...new Set(featureIds)].sort();
    if (canonical.length === 0) {
      if (previous.has(domain)) removals.add(domain);
    } else if (!sameFeatureIds(previous.get(domain), canonical)) {
      updates.set(domain, canonical);
    }
  }

  private nextFeatureRemoval(): SceneDraftWorkUnit | undefined {
    if (this.removedComplete) {
      this.phase = 'add-feature-domains';
      return this.nextWork();
    }
    this.removedIterator ??= this.options.replacedFeatureIds.values();
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:remove-feature-domains:${this.featureOffset}`,
      run: () => {
        const removals = new Set<RenderFeatureId>();
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.removedIterator?.next();
          if (!entry || entry.done) {
            this.removedComplete = true;
            break;
          }
          removals.add(entry.value);
          this.featureOffset += 1;
        }
        this.domainsByFeature = overlayReadonlyMap(
          this.domainsByFeature,
          new Map<RenderFeatureId, readonly RenderDomainIdentity[]>(),
          removals,
        );
      },
    };
  }

  private nextFeatureAddition(): SceneDraftWorkUnit | undefined {
    if (this.partialComplete) {
      this.phase = 'complete';
      return undefined;
    }
    this.partialIterator ??= this.options.partial.domainsByFeature.entries();
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:add-feature-domains:${this.featureOffset}`,
      run: () => {
        const updates = new Map<RenderFeatureId, readonly RenderDomainIdentity[]>();
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.partialIterator?.next();
          if (!entry || entry.done) {
            this.partialComplete = true;
            break;
          }
          updates.set(entry.value[0], entry.value[1]);
          this.featureOffset += 1;
        }
        this.domainsByFeature = overlayReadonlyMap(this.domainsByFeature, updates, new Set());
      },
    };
  }
}
