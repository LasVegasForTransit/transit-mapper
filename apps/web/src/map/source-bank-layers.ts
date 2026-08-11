/**
 * MapLibre source/layer identity and visibility for committed renderer banks.
 * Inactive layers stay layout-visible but translated offscreen while loading,
 * which builds their buckets without letting hidden labels enter collision
 * placement. Activation restores one bank's original translations at once.
 */
import type { LayerSpecification } from 'maplibre-gl';
import { SRC_HIT_FEATURES } from './layers/constants';
import {
  bankedLayerId,
  bankedSourceId,
  SOURCE_BANK_IDS,
  type SourceBankController,
  type SourceBankId,
} from './source-bank';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from './system-feature-sources';

const BANK_SUFFIX = '--bank-';
const BANKED_RENDER_SOURCE_IDS = new Set<string>([
  ...COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
]);

export const OFFSCREEN_RENDER_TRANSLATE = [1_048_576, 0] as const;

export interface RenderOverlayHealthInput {
  readonly sourceIds: readonly string[];
  readonly layerIds: readonly string[];
  hasSource(sourceId: string): boolean;
  hasLayer(layerId: string): boolean;
}

function layerSourceId(spec: LayerSpecification): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

function stripBankSuffix(id: string): string {
  const suffixIndex = id.lastIndexOf(BANK_SUFFIX);
  if (suffixIndex < 0) return id;
  const bank = id.slice(suffixIndex + BANK_SUFFIX.length);
  return bank === 'a' || bank === 'b' ? id.slice(0, suffixIndex) : id;
}

export function isBankedRenderSourceId(sourceId: string): boolean {
  return BANKED_RENDER_SOURCE_IDS.has(sourceId);
}

export function logicalRenderSourceId(sourceId: string): string {
  return stripBankSuffix(sourceId);
}

export function logicalRenderLayerId(layerId: string): string {
  return stripBankSuffix(layerId);
}

export function sourceBankForPhysicalId(sourceId: string): SourceBankId | null {
  if (sourceId.endsWith('--bank-a')) return 'a';
  if (sourceId.endsWith('--bank-b')) return 'b';
  return null;
}

export function physicalRenderSourceIds(logicalSourceIds: readonly string[]): string[] {
  return logicalSourceIds.flatMap((sourceId) =>
    isBankedRenderSourceId(sourceId)
      ? SOURCE_BANK_IDS.map((bank) => bankedSourceId(sourceId, bank))
      : [sourceId],
  );
}

export function logicalBankedLayerIds(specs: readonly LayerSpecification[]): ReadonlySet<string> {
  return new Set(
    specs.flatMap((spec) => {
      const sourceId = layerSourceId(spec);
      return sourceId && isBankedRenderSourceId(sourceId) ? [spec.id] : [];
    }),
  );
}

export function physicalRenderLayerIds(
  logicalLayerId: string,
  bankedLayerIds: ReadonlySet<string>,
  activeBank: SourceBankId | null,
): string[] {
  if (!bankedLayerIds.has(logicalLayerId)) return [logicalLayerId];
  return activeBank ? [bankedLayerId(logicalLayerId, activeBank)] : [];
}

export function renderOverlayNeedsHealing(input: RenderOverlayHealthInput): boolean {
  return (
    input.sourceIds.some((sourceId) => !input.hasSource(sourceId)) ||
    input.layerIds.some((layerId) => !input.hasLayer(layerId))
  );
}

export function renderLayerTranslateProperties(spec: LayerSpecification): readonly string[] {
  if (spec.type === 'line') return ['line-translate'];
  if (spec.type === 'fill') return ['fill-translate'];
  if (spec.type === 'circle') return ['circle-translate'];
  if (spec.type === 'symbol') {
    const layout: Record<string, unknown> | undefined = spec.layout;
    return [
      ...(layout?.['icon-image'] === undefined ? [] : ['icon-translate']),
      ...(layout?.['text-field'] === undefined ? [] : ['text-translate']),
    ];
  }
  return [];
}

function hiddenBankPaint(spec: LayerSpecification): Record<string, unknown> {
  const paint: Record<string, unknown> = { ...spec.paint };
  for (const property of renderLayerTranslateProperties(spec)) {
    paint[property] = OFFSCREEN_RENDER_TRANSLATE;
    paint[`${property}-anchor`] = 'viewport';
    paint[`${property}-transition`] = { duration: 0, delay: 0 };
  }
  return paint;
}

export function isBankedRenderLayer(spec: LayerSpecification): boolean {
  const sourceId = layerSourceId(spec);
  return sourceId !== null && isBankedRenderSourceId(sourceId);
}

function bankedSpec(spec: LayerSpecification, bank: SourceBankId): LayerSpecification {
  const sourceId = layerSourceId(spec);
  if (!sourceId) throw new Error(`Layer ${spec.id} has no bankable source.`);
  return {
    ...spec,
    id: bankedLayerId(spec.id, bank),
    source: bankedSourceId(sourceId, bank),
    layout: { ...spec.layout, visibility: 'none' },
    paint: hiddenBankPaint(spec),
  } as LayerSpecification;
}

/**
 * Expands each committed layer in place so both physical banks preserve the
 * logical bottom-to-top order. Editor, vehicle, preview, and basemap layers
 * are intentionally unbanked and therefore appear only once.
 */
export function sourceBankLayerSpecs(
  logicalSpecs: readonly LayerSpecification[],
): LayerSpecification[] {
  return logicalSpecs.flatMap((spec) =>
    isBankedRenderLayer(spec) ? SOURCE_BANK_IDS.map((bank) => bankedSpec(spec, bank)) : [spec],
  );
}

export type RenderLayerVisibility = 'visible' | 'none';

export interface SourceBankLayerHost {
  hasLayer(layerId: string): boolean;
  setVisibility(layerId: string, visibility: RenderLayerVisibility): void;
  setPaintProperty(layerId: string, property: string, value: unknown): void;
}

export interface SourceBankLayerControllerOptions {
  readonly bankController: SourceBankController;
  readonly logicalSpecs: readonly LayerSpecification[];
  readonly host: SourceBankLayerHost;
  now(): number;
}

export interface SourceBankFlipMetrics {
  readonly durationMs: number;
  readonly operationCount: number;
}

export interface SourceBankLayerController {
  prepare(bank: SourceBankId): SourceBankFlipMetrics;
  stagingBankId(): SourceBankId | null;
  activate(bank: SourceBankId): SourceBankFlipMetrics;
  finishActivation(bank: SourceBankId): void;
  finishStaging(bank: SourceBankId): void;
  restore(bank: SourceBankId): SourceBankFlipMetrics;
  setLogicalVisibility(logicalLayerId: string, visibility: RenderLayerVisibility): void;
  setLogicalPaintProperty(logicalLayerId: string, property: string, value: unknown): void;
  activeLayerId(logicalLayerId: string): string | null;
  forEachPhysicalLayer(logicalLayerId: string, callback: (physicalLayerId: string) => void): void;
  allLayerIds(): ReadonlySet<string>;
}

interface BankedLayerRecord {
  readonly id: string;
  readonly translateProperties: readonly string[];
  readonly translate: Map<string, unknown>;
  readonly translateAnchor: Map<string, unknown>;
  readonly paintOverrides: Map<string, unknown>;
  visibility: RenderLayerVisibility;
}

function initialTranslate(
  spec: LayerSpecification,
  properties: readonly string[],
): Map<string, unknown> {
  const paint: Record<string, unknown> | undefined = spec.paint;
  return new Map(properties.map((property) => [property, paint?.[property] ?? [0, 0]]));
}

function initialTranslateAnchors(
  spec: LayerSpecification,
  properties: readonly string[],
): Map<string, unknown> {
  const paint: Record<string, unknown> | undefined = spec.paint;
  return new Map(properties.map((property) => [property, paint?.[`${property}-anchor`] ?? 'map']));
}

class SourceBankLayerControllerImplementation implements SourceBankLayerController {
  private readonly layers: readonly BankedLayerRecord[];
  private readonly layerIds: ReadonlySet<string>;
  private stagingBank: SourceBankId | null = null;

  constructor(private readonly options: SourceBankLayerControllerOptions) {
    this.layers = options.logicalSpecs.filter(isBankedRenderLayer).map((spec) => ({
      id: spec.id,
      translateProperties: renderLayerTranslateProperties(spec),
      translate: initialTranslate(spec, renderLayerTranslateProperties(spec)),
      translateAnchor: initialTranslateAnchors(spec, renderLayerTranslateProperties(spec)),
      paintOverrides: new Map(),
      visibility: spec.layout?.visibility ?? 'visible',
    }));
    this.layerIds = new Set(
      options.logicalSpecs.flatMap((spec) =>
        isBankedRenderLayer(spec)
          ? SOURCE_BANK_IDS.map((bank) => bankedLayerId(spec.id, bank))
          : [spec.id],
      ),
    );
  }

  prepare(bank: SourceBankId): SourceBankFlipMetrics {
    this.stagingBank = bank;
    return this.applyPreparedBank(bank);
  }

  stagingBankId(): SourceBankId | null {
    return this.stagingBank;
  }

  activate(bank: SourceBankId): SourceBankFlipMetrics {
    const metrics = this.applyBankTranslation(bank);
    this.stagingBank = null;
    this.options.bankController.recordFlipMetrics(metrics.durationMs, metrics.operationCount);
    return metrics;
  }

  finishActivation(bank: SourceBankId): void {
    this.hideBank(bank === 'a' ? 'b' : 'a');
  }

  finishStaging(bank: SourceBankId): void {
    if (this.options.bankController.activeBank() !== bank) this.hideBank(bank);
    if (this.stagingBank === bank) this.stagingBank = null;
  }

  restore(bank: SourceBankId): SourceBankFlipMetrics {
    const metrics = this.applyBankTranslation(bank);
    this.finishActivation(bank);
    return metrics;
  }

  setLogicalVisibility(logicalLayerId: string, visibility: RenderLayerVisibility): void {
    const layer = this.layers.find((candidate) => candidate.id === logicalLayerId);
    if (!layer) return;
    layer.visibility = visibility;
    const activeBank = this.options.bankController.activeBank();
    for (const bank of SOURCE_BANK_IDS) {
      const physicalLayerId = bankedLayerId(logicalLayerId, bank);
      if (this.options.host.hasLayer(physicalLayerId)) {
        const ownsPaint = bank === activeBank || bank === this.stagingBank;
        this.options.host.setVisibility(physicalLayerId, ownsPaint ? visibility : 'none');
      }
    }
  }

  setLogicalPaintProperty(logicalLayerId: string, property: string, value: unknown): void {
    const layer = this.layers.find((candidate) => candidate.id === logicalLayerId);
    if (!layer) return;
    layer.paintOverrides.set(property, value);
    const activeBank = this.options.bankController.activeBank();
    for (const bank of SOURCE_BANK_IDS) {
      if (bank !== activeBank && bank !== this.stagingBank) continue;
      const physicalLayerId = bankedLayerId(logicalLayerId, bank);
      if (this.options.host.hasLayer(physicalLayerId)) {
        this.options.host.setPaintProperty(physicalLayerId, property, value);
      }
    }
  }

  activeLayerId(logicalLayerId: string): string | null {
    return this.options.bankController.activeLayerId(logicalLayerId);
  }

  forEachPhysicalLayer(logicalLayerId: string, callback: (physicalLayerId: string) => void): void {
    for (const bank of SOURCE_BANK_IDS) callback(bankedLayerId(logicalLayerId, bank));
  }

  allLayerIds(): ReadonlySet<string> {
    return this.layerIds;
  }

  private applyPreparedBank(bank: SourceBankId): SourceBankFlipMetrics {
    const startedAt = this.options.now();
    let operationCount = 0;
    for (const layer of this.layers) {
      const physicalLayerId = bankedLayerId(layer.id, bank);
      if (!this.options.host.hasLayer(physicalLayerId)) continue;
      this.options.host.setVisibility(physicalLayerId, layer.visibility);
      operationCount += 1;
      for (const property of layer.translateProperties) {
        this.options.host.setPaintProperty(physicalLayerId, property, OFFSCREEN_RENDER_TRANSLATE);
        this.options.host.setPaintProperty(physicalLayerId, `${property}-anchor`, 'viewport');
        operationCount += 2;
      }
      for (const [property, value] of layer.paintOverrides) {
        this.options.host.setPaintProperty(physicalLayerId, property, value);
        operationCount += 1;
      }
    }
    return { durationMs: this.options.now() - startedAt, operationCount };
  }

  private applyBankTranslation(bank: SourceBankId): SourceBankFlipMetrics {
    const startedAt = this.options.now();
    let operationCount = 0;
    for (const layer of this.layers) {
      for (const candidateBank of SOURCE_BANK_IDS) {
        operationCount += this.applyPhysicalLayerTranslation(layer, candidateBank, bank);
      }
    }
    return { durationMs: this.options.now() - startedAt, operationCount };
  }

  private applyPhysicalLayerTranslation(
    layer: BankedLayerRecord,
    candidateBank: SourceBankId,
    activeBank: SourceBankId,
  ): number {
    const physicalLayerId = bankedLayerId(layer.id, candidateBank);
    if (!this.options.host.hasLayer(physicalLayerId)) return 0;
    const active = candidateBank === activeBank;
    this.options.host.setVisibility(physicalLayerId, layer.visibility);
    for (const property of layer.translateProperties) {
      this.options.host.setPaintProperty(
        physicalLayerId,
        property,
        active ? layer.translate.get(property) : OFFSCREEN_RENDER_TRANSLATE,
      );
      this.options.host.setPaintProperty(
        physicalLayerId,
        `${property}-anchor`,
        active ? layer.translateAnchor.get(property) : 'viewport',
      );
    }
    return 1 + layer.translateProperties.length * 2;
  }

  private hideBank(bank: SourceBankId): void {
    for (const layer of this.layers) {
      const physicalLayerId = bankedLayerId(layer.id, bank);
      if (this.options.host.hasLayer(physicalLayerId)) {
        this.options.host.setVisibility(physicalLayerId, 'none');
      }
    }
  }
}

export function createSourceBankLayerController(
  options: SourceBankLayerControllerOptions,
): SourceBankLayerController {
  return new SourceBankLayerControllerImplementation(options);
}
