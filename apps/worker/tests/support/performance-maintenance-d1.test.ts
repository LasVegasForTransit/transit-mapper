interface SampleRow extends Record<string, unknown> {
  rowid: number;
  received_at: number;
  schema_version: number;
  build_id: string;
  surface: string;
  cache_state: string;
  service_worker_state: string;
  device_tier: string;
  network_tier: string;
  capability_bits: number;
  lcp_ms: number | null;
  total_bytes: number;
}

interface AggregateRow {
  dayStart: number;
  buildId: string;
  sampleCount: number;
  metricsJson: string;
  completedAt: number;
}

interface CompletionRow {
  dayStart: number;
  sampleCount: number;
  completedAt: number;
}

interface TestDatabaseOptions {
  samples: SampleRow[];
  waitForTwoBatches?: boolean;
  insertAfterFirstCohortRead?: SampleRow;
  failSecondMetricAfterPeerCompletion?: boolean;
}

function d1Result<T>(results: T[] = []): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    },
  };
}

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

class TestStatement {
  readonly query: string;
  readonly bindings: readonly unknown[];

  constructor(
    private readonly database: TestPerformanceDatabase,
    query: string,
    bindings: readonly unknown[] = [],
  ) {
    this.query = normalized(query);
    this.bindings = bindings;
  }

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.database, this.query, values);
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = await this.database.first(this);
    if (columnName === undefined) return row as T | null;
    return (row?.[columnName] ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return d1Result((await this.database.all(this)) as T[]);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    await this.database.run(this);
    return d1Result<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    void options;
    return Promise.reject(new Error('raw is not used by performance maintenance'));
  }
}

interface PendingBatch {
  statements: TestStatement[];
  resolve: (results: D1Result[]) => void;
  reject: (error: unknown) => void;
}

export class TestPerformanceDatabase {
  readonly samples: SampleRow[];
  readonly aggregates: AggregateRow[] = [];
  completion: CompletionRow | null = null;
  batchAttempts = 0;
  rawRetentionAttempts = 0;

  private cohortReads = 0;
  private metricReads = 0;
  private completionOwnerToken: string | null = null;
  private readonly pendingBatches: PendingBatch[] = [];
  private readonly waitForTwoBatches: boolean;
  private readonly failSecondMetricAfterPeerCompletion: boolean;
  private insertAfterFirstCohortRead: SampleRow | undefined;
  private rejectMetricAfterPeerCompletion: (() => void) | undefined;

  constructor(options: TestDatabaseOptions) {
    this.samples = [...options.samples];
    this.waitForTwoBatches = options.waitForTwoBatches ?? false;
    this.failSecondMetricAfterPeerCompletion = options.failSecondMetricAfterPeerCompletion ?? false;
    this.insertAfterFirstCohortRead = options.insertAfterFirstCohortRead;
  }

  prepare(query: string): TestStatement {
    return new TestStatement(this, query);
  }

  async batch<T = unknown>(statements: TestStatement[]): Promise<D1Result<T>[]> {
    this.batchAttempts += 1;
    if (!this.waitForTwoBatches) {
      return this.executeBatch(statements) as D1Result<T>[];
    }

    return new Promise<D1Result<T>[]>((resolve, reject) => {
      this.pendingBatches.push({
        statements,
        resolve: (results) => resolve(results as D1Result<T>[]),
        reject,
      });
      if (this.pendingBatches.length === 2) this.flushOverlappingBatches();
    });
  }

  exec(_query: string): Promise<D1ExecResult> {
    return Promise.reject(new Error('exec is not used by performance maintenance'));
  }

  withSession(): D1DatabaseSession {
    throw new Error('sessions are not used by performance maintenance');
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error('dump is not used by performance maintenance'));
  }

  first(statement: TestStatement): Promise<Record<string, unknown> | null> {
    if (statement.query.includes('FROM performance_sample_aggregation_days WHERE day_start')) {
      const dayStart = Number(statement.bindings[0]);
      if (this.completion?.dayStart !== dayStart) return Promise.resolve(null);
      return Promise.resolve({ completed: 1 });
    }

    if (statement.query.includes('MAX(rowid) AS max_rowid')) {
      const rows = this.rowsInRange(statement.bindings);
      return Promise.resolve({
        max_rowid: rows.length === 0 ? null : Math.max(...rows.map(({ rowid }) => rowid)),
        sample_count: rows.length,
      });
    }

    return Promise.reject(new Error(`Unexpected first query: ${statement.query}`));
  }

  all(statement: TestStatement): Promise<Record<string, unknown>[]> {
    if (statement.query.includes("strftime('%s', received_at / 1000")) {
      const before = Number(statement.bindings[0]);
      return Promise.resolve(
        [...new Set(this.samples.filter((row) => row.received_at < before).map(dayStartFor))]
          .sort((left, right) => left - right)
          .map((day_start) => ({ day_start })),
      );
    }

    if (
      statement.query.includes('COUNT(*) AS sample_count') &&
      statement.query.includes('GROUP BY')
    ) {
      const rows = this.rowsInRange(statement.bindings);
      const cohorts = new Map<string, SampleRow[]>();
      for (const row of rows) {
        const key = [
          row.schema_version,
          row.build_id,
          row.surface,
          row.cache_state,
          row.service_worker_state,
          row.device_tier,
          row.network_tier,
          row.capability_bits,
        ].join('|');
        cohorts.set(key, [...(cohorts.get(key) ?? []), row]);
      }
      const result = [...cohorts.values()].map((cohortRows) => ({
        ...cohortRows[0],
        sample_count: cohortRows.length,
      }));
      this.cohortReads += 1;
      if (this.cohortReads === 1 && this.insertAfterFirstCohortRead) {
        this.samples.push(this.insertAfterFirstCohortRead);
        this.insertAfterFirstCohortRead = undefined;
      }
      return Promise.resolve(result);
    }

    if (statement.query.startsWith('SELECT document_response_end_ms')) {
      const rows = this.rowsInRange(statement.bindings);
      const cohortOffset = statement.bindings.length >= 11 ? 3 : 2;
      const result = rows.filter(
        (row) =>
          row.schema_version === statement.bindings[cohortOffset] &&
          row.build_id === statement.bindings[cohortOffset + 1] &&
          row.surface === statement.bindings[cohortOffset + 2] &&
          row.cache_state === statement.bindings[cohortOffset + 3] &&
          row.service_worker_state === statement.bindings[cohortOffset + 4] &&
          row.device_tier === statement.bindings[cohortOffset + 5] &&
          row.network_tier === statement.bindings[cohortOffset + 6] &&
          row.capability_bits === statement.bindings[cohortOffset + 7],
      );
      this.metricReads += 1;
      if (this.failSecondMetricAfterPeerCompletion && this.metricReads === 2) {
        return new Promise((_, reject) => {
          this.rejectMetricAfterPeerCompletion = () =>
            reject(new Error('forced unrelated metric failure'));
          this.releaseMetricFailureAfterCompletion();
        });
      }
      return Promise.resolve(result);
    }

    return Promise.reject(new Error(`Unexpected all query: ${statement.query}`));
  }

  run(statement: TestStatement): Promise<void> {
    if (statement.query.startsWith('DELETE FROM performance_samples')) {
      this.rawRetentionAttempts += 1;
      return Promise.resolve();
    }
    if (statement.query.startsWith('DELETE FROM performance_daily_aggregates')) {
      return Promise.resolve();
    }
    if (statement.query.startsWith('DELETE FROM performance_sample_aggregation_days')) {
      return Promise.resolve();
    }
    if (statement.query.startsWith('DELETE FROM systems')) return Promise.resolve();
    return Promise.reject(new Error(`Unexpected run query: ${statement.query}`));
  }

  private rowsInRange(bindings: readonly unknown[]): SampleRow[] {
    const dayStart = Number(bindings[0]);
    const dayEnd = Number(bindings[1]);
    const cutoff = bindings.length >= 3 && typeof bindings[2] === 'number' ? bindings[2] : Infinity;
    return this.samples.filter(
      (row) => row.received_at >= dayStart && row.received_at < dayEnd && row.rowid <= cutoff,
    );
  }

  private executeBatch(statements: TestStatement[]): D1Result[] {
    const priorCompletion = this.completion;
    const priorOwnerToken = this.completionOwnerToken;
    const priorAggregates = [...this.aggregates];
    try {
      for (const statement of statements) this.executeWrite(statement);
      return statements.map(() => d1Result());
    } catch (error) {
      this.completion = priorCompletion;
      this.completionOwnerToken = priorOwnerToken;
      this.aggregates.splice(0, this.aggregates.length, ...priorAggregates);
      throw error;
    }
  }

  private executeAggregateDelete(statement: TestStatement): boolean {
    if (!statement.query.startsWith('DELETE FROM performance_daily_aggregates')) return false;
    const dayStart = Number(statement.bindings[0]);
    const owned =
      statement.bindings.length === 1 ||
      (this.completion?.dayStart === Number(statement.bindings[1]) &&
        this.completionOwnerToken === String(statement.bindings[2]));
    if (owned) {
      this.aggregates.splice(
        0,
        this.aggregates.length,
        ...this.aggregates.filter((row) => row.dayStart !== dayStart),
      );
    }
    return true;
  }

  private executeAggregateInsert(statement: TestStatement): boolean {
    if (!statement.query.includes('INTO performance_daily_aggregates')) return false;
    const owned =
      !statement.query.includes('WHERE EXISTS') ||
      (this.completion?.dayStart === Number(statement.bindings[12]) &&
        this.completionOwnerToken === String(statement.bindings[13]));
    if (owned) {
      this.aggregates.push({
        dayStart: Number(statement.bindings[0]),
        buildId: String(statement.bindings[2]),
        sampleCount: Number(statement.bindings[9]),
        metricsJson: String(statement.bindings[10]),
        completedAt: Number(statement.bindings[11]),
      });
    }
    return true;
  }

  private executeCompletionInsert(statement: TestStatement): boolean {
    if (!statement.query.includes('INTO performance_sample_aggregation_days')) return false;
    const replacing = statement.query.startsWith('INSERT OR REPLACE');
    if (!replacing && this.completion) {
      if (statement.query.includes('ON CONFLICT(day_start) DO NOTHING')) return true;
      throw new Error('D1_ERROR: constraint failed: SQLITE_CONSTRAINT_UNIQUE');
    }

    if (statement.query.includes('CASE WHEN')) {
      const dayStart = Number(statement.bindings[1]);
      const dayEnd = Number(statement.bindings[2]);
      const cutoff = Number(statement.bindings[3]);
      const expectedCount = Number(statement.bindings[4]);
      const snapshotRows = this.samples.filter(
        (row) => row.received_at >= dayStart && row.received_at < dayEnd && row.rowid <= cutoff,
      );
      const lateRowExists = this.samples.some(
        (row) => row.received_at >= dayStart && row.received_at < dayEnd && row.rowid > cutoff,
      );
      if (snapshotRows.length !== expectedCount || lateRowExists) {
        throw new Error('CHECK constraint failed: sample_count');
      }
      this.completion = {
        dayStart: Number(statement.bindings[0]),
        sampleCount: Number(statement.bindings[8]),
        completedAt: Number(statement.bindings[9]),
      };
      this.completionOwnerToken = String(statement.bindings[10]);
    } else {
      this.completion = {
        dayStart: Number(statement.bindings[0]),
        sampleCount: Number(statement.bindings[1]),
        completedAt: Number(statement.bindings[2]),
      };
      this.completionOwnerToken = null;
    }
    this.releaseMetricFailureAfterCompletion();
    return true;
  }

  private executeWrite(statement: TestStatement): void {
    if (this.executeAggregateDelete(statement)) return;
    if (this.executeAggregateInsert(statement)) return;
    if (this.executeCompletionInsert(statement)) return;
    throw new Error(`Unexpected batch query: ${statement.query}`);
  }

  private flushOverlappingBatches(): void {
    const batches = this.pendingBatches.splice(0);
    for (const batch of batches) {
      try {
        batch.resolve(this.executeBatch(batch.statements));
      } catch (error) {
        batch.reject(error);
      }
    }
  }

  private releaseMetricFailureAfterCompletion(): void {
    if (!this.completion || !this.rejectMetricAfterPeerCompletion) return;
    const reject = this.rejectMetricAfterPeerCompletion;
    this.rejectMetricAfterPeerCompletion = undefined;
    reject();
  }
}

export function sampleRow(rowid: number, receivedAt: number, lcpMs: number): SampleRow {
  return {
    rowid,
    received_at: receivedAt,
    schema_version: 1,
    build_id: 'build-a',
    surface: 'editor',
    cache_state: 'cold',
    service_worker_state: 'controlled',
    device_tier: 'standard',
    network_tier: 'fast',
    capability_bits: 1,
    lcp_ms: lcpMs,
    total_bytes: lcpMs * 10,
  };
}

function dayStartFor(row: SampleRow): number {
  const date = new Date(row.received_at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
