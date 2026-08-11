/**
 * Logical ownership for the two physical committed-renderer banks.
 *
 * The controller knows revisions and transaction rollback; it deliberately
 * knows nothing about MapLibre sources or layers. Data update policy and
 * visual layer switching live in their own modules.
 */
export type SourceBankId = 'a' | 'b';

export const SOURCE_BANK_IDS = ['a', 'b'] as const;

export function bankedSourceId(logicalSourceId: string, bank: SourceBankId): string {
  return `${logicalSourceId}--bank-${bank}`;
}

export function bankedLayerId(logicalLayerId: string, bank: SourceBankId): string {
  return `${logicalLayerId}--bank-${bank}`;
}

export interface SourceBankRevision {
  readonly revision: string;
  readonly residentFeatureCount: number;
}

export interface BeginSourceBankTransaction {
  readonly logicalSourceIds: readonly string[];
}

export interface SourceBankTransaction {
  readonly bank: SourceBankId;
  readonly sourceIds: readonly string[];
  recordLoaded(physicalSourceId: string): void;
  retain(activation: SourceBankRevision): void;
  activate(activation: SourceBankRevision): void;
  confirmActivation(): void;
  abort(): void;
}

export interface SourceBankDiagnostics {
  readonly bankedTransactionCount: number;
  readonly flipCount: number;
  readonly hiddenSourceLoadCount: number;
  readonly abortCount: number;
  readonly styleRebuildCount: number;
  readonly lastFlipDurationMs: number;
  readonly maxFlipDurationMs: number;
  readonly lastFlipOperationCount: number;
  readonly maxFlipOperationCount: number;
  readonly residentFeatureCountByBank: Readonly<Record<SourceBankId, number>>;
  readonly residentRevisionByBank: Readonly<Record<SourceBankId, string | null>>;
}

export interface SourceBankController {
  begin(options: BeginSourceBankTransaction): SourceBankTransaction;
  activeBank(): SourceBankId | null;
  activeRevision(): string | null;
  activeSourceId(logicalSourceId: string): string | null;
  activeLayerId(logicalLayerId: string): string | null;
  residentRevision(bank: SourceBankId): string | null;
  updateActiveResident(activation: SourceBankRevision): void;
  recordFlipMetrics(durationMs: number, operationCount: number): void;
  noteStyleRebuild(): void;
  snapshot(): SourceBankDiagnostics;
}

interface MutableBankDiagnostics {
  bankedTransactionCount: number;
  flipCount: number;
  hiddenSourceLoadCount: number;
  abortCount: number;
  styleRebuildCount: number;
  lastFlipDurationMs: number;
  maxFlipDurationMs: number;
  lastFlipOperationCount: number;
  maxFlipOperationCount: number;
  residentFeatureCountByBank: Record<SourceBankId, number>;
}

interface CreateBankTransactionOptions {
  readonly token: object;
  readonly bank: SourceBankId;
  readonly sourceIds: readonly string[];
}

function otherBank(bank: SourceBankId): SourceBankId {
  return bank === 'a' ? 'b' : 'a';
}

function emptyBankDiagnostics(): MutableBankDiagnostics {
  return {
    bankedTransactionCount: 0,
    flipCount: 0,
    hiddenSourceLoadCount: 0,
    abortCount: 0,
    styleRebuildCount: 0,
    lastFlipDurationMs: 0,
    maxFlipDurationMs: 0,
    lastFlipOperationCount: 0,
    maxFlipOperationCount: 0,
    residentFeatureCountByBank: { a: 0, b: 0 },
  };
}

/** Owns logical renderer-bank identity only. Source upload and MapLibre layer
 * mutation remain separate so a hidden transaction can fail without changing
 * the active visual or interaction bank. */
class SourceBankControllerImplementation implements SourceBankController {
  private currentActiveBank: SourceBankId | null = null;
  private activeTransaction: object | null = null;
  private provisionalActivation: {
    readonly token: object;
    readonly bank: SourceBankId;
    readonly previousBank: SourceBankId | null;
    readonly previousTargetRevision: string | null;
    readonly previousTargetFeatureCount: number;
  } | null = null;
  private readonly residentRevisions: Record<SourceBankId, string | null> = {
    a: null,
    b: null,
  };
  private readonly diagnostics = emptyBankDiagnostics();

  begin({ logicalSourceIds }: BeginSourceBankTransaction): SourceBankTransaction {
    if (this.activeTransaction) throw new Error('A render source bank transaction is active.');
    // Beginning later work is an implicit acknowledgement for direct users of
    // the controller. Production source plans confirm immediately after their
    // CPU scene publication, while retaining rollback through the post-flip
    // render barrier.
    this.provisionalActivation = null;
    const token = {};
    this.activeTransaction = token;
    this.diagnostics.bankedTransactionCount += 1;
    const bank = this.currentActiveBank === null ? 'a' : otherBank(this.currentActiveBank);
    const sourceIds = [...new Set(logicalSourceIds)].map((sourceId) =>
      bankedSourceId(sourceId, bank),
    );
    return this.createTransaction({ token, bank, sourceIds });
  }

  private createTransaction({
    token,
    bank,
    sourceIds,
  }: CreateBankTransactionOptions): SourceBankTransaction {
    const expected = new Set(sourceIds);
    const loaded = new Set<string>();
    const requireActive = () => {
      if (this.activeTransaction !== token) {
        throw new Error('The render source bank transaction is no longer active.');
      }
    };
    return {
      bank,
      sourceIds,
      recordLoaded: (physicalSourceId) => {
        requireActive();
        if (!expected.has(physicalSourceId)) {
          throw new Error(`Unexpected hidden render source: ${physicalSourceId}`);
        }
        if (loaded.has(physicalSourceId)) return;
        loaded.add(physicalSourceId);
        this.diagnostics.hiddenSourceLoadCount += 1;
      },
      retain: ({ revision, residentFeatureCount }) => {
        requireActive();
        if (loaded.size !== expected.size) {
          throw new Error('Cannot retain before the exact hidden source set is loaded.');
        }
        this.residentRevisions[bank] = revision;
        this.diagnostics.residentFeatureCountByBank[bank] = residentFeatureCount;
        this.activeTransaction = null;
      },
      activate: ({ revision, residentFeatureCount }) => {
        requireActive();
        if (loaded.size !== expected.size) {
          throw new Error('Cannot activate before the exact hidden source set is loaded.');
        }
        const previousTargetRevision = this.residentRevisions[bank];
        const previousTargetFeatureCount = this.diagnostics.residentFeatureCountByBank[bank];
        this.residentRevisions[bank] = revision;
        this.diagnostics.residentFeatureCountByBank[bank] = residentFeatureCount;
        const previousBank = this.currentActiveBank;
        this.currentActiveBank = bank;
        this.activeTransaction = null;
        this.provisionalActivation = {
          token,
          bank,
          previousBank,
          previousTargetRevision,
          previousTargetFeatureCount,
        };
        this.diagnostics.flipCount += 1;
      },
      confirmActivation: () => {
        if (this.provisionalActivation?.token === token) {
          this.provisionalActivation = null;
        }
      },
      abort: () => {
        if (this.activeTransaction === token) {
          this.activeTransaction = null;
          this.diagnostics.abortCount += 1;
          return;
        }
        if (this.provisionalActivation?.token !== token) return;
        const provisional = this.provisionalActivation;
        this.currentActiveBank = provisional.previousBank;
        this.residentRevisions[provisional.bank] = provisional.previousTargetRevision;
        this.diagnostics.residentFeatureCountByBank[provisional.bank] =
          provisional.previousTargetFeatureCount;
        this.provisionalActivation = null;
        this.diagnostics.flipCount -= 1;
        this.diagnostics.abortCount += 1;
      },
    };
  }

  activeBank(): SourceBankId | null {
    return this.currentActiveBank;
  }

  activeRevision(): string | null {
    return this.currentActiveBank === null ? null : this.residentRevisions[this.currentActiveBank];
  }

  activeSourceId(logicalSourceId: string): string | null {
    return this.currentActiveBank === null
      ? null
      : bankedSourceId(logicalSourceId, this.currentActiveBank);
  }

  activeLayerId(logicalLayerId: string): string | null {
    return this.currentActiveBank === null
      ? null
      : bankedLayerId(logicalLayerId, this.currentActiveBank);
  }

  residentRevision(bank: SourceBankId): string | null {
    return this.residentRevisions[bank];
  }

  updateActiveResident({ revision, residentFeatureCount }: SourceBankRevision): void {
    if (this.currentActiveBank === null) {
      throw new Error('No active render source bank can accept a resident revision.');
    }
    this.residentRevisions[this.currentActiveBank] = revision;
    this.diagnostics.residentFeatureCountByBank[this.currentActiveBank] = residentFeatureCount;
  }

  recordFlipMetrics(durationMs: number, operationCount: number): void {
    this.diagnostics.lastFlipDurationMs = durationMs;
    this.diagnostics.maxFlipDurationMs = Math.max(this.diagnostics.maxFlipDurationMs, durationMs);
    this.diagnostics.lastFlipOperationCount = operationCount;
    this.diagnostics.maxFlipOperationCount = Math.max(
      this.diagnostics.maxFlipOperationCount,
      operationCount,
    );
  }

  noteStyleRebuild(): void {
    this.diagnostics.styleRebuildCount += 1;
  }

  snapshot(): SourceBankDiagnostics {
    return {
      ...this.diagnostics,
      residentFeatureCountByBank: { ...this.diagnostics.residentFeatureCountByBank },
      residentRevisionByBank: { ...this.residentRevisions },
    };
  }
}

export function createSourceBankController(): SourceBankController {
  return new SourceBankControllerImplementation();
}
