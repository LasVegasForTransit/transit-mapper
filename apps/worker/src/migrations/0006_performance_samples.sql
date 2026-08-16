-- Anonymous real-user performance samples. This table is intentionally wide:
-- every accepted field has a named, typed column, so there is nowhere to put
-- raw JSON, identity, URLs, document content, coordinates, input or headers.
CREATE TABLE performance_samples (
  -- Worker receipt time in epoch milliseconds; the client cannot backdate a
  -- sample into another retention or aggregation window.
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  -- Version of the public allowlist that validated this row.
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  -- Release/build label, bounded and validated by the shared contract.
  build_id TEXT NOT NULL CHECK (length(build_id) BETWEEN 1 AND 80),
  -- Coarse application surface; never a URL or share/document identifier.
  surface TEXT NOT NULL CHECK (surface IN ('editor', 'share', 'embed')),

  -- Navigation response completion relative to navigation start, in ms.
  document_response_end_ms REAL CHECK (document_response_end_ms BETWEEN 0 AND 600000),
  -- First committed application shell relative to navigation start, in ms.
  shell_mounted_ms REAL CHECK (shell_mounted_ms BETWEEN 0 AND 600000),
  -- Storage/bootstrap decision completion, in ms.
  bootstrap_complete_ms REAL CHECK (bootstrap_complete_ms BETWEEN 0 AND 600000),
  -- Initial local storage read completion, in ms.
  storage_complete_ms REAL CHECK (storage_complete_ms BETWEEN 0 AND 600000),
  -- Initial document deserialization completion, in ms when applicable.
  deserialize_complete_ms REAL CHECK (deserialize_complete_ms BETWEEN 0 AND 600000),
  -- First usable transit-system state commit, in ms.
  system_committed_ms REAL CHECK (system_committed_ms BETWEEN 0 AND 600000),
  -- First painted transit system, in ms.
  first_system_paint_ms REAL CHECK (first_system_paint_ms BETWEEN 0 AND 600000),
  -- Point at which the surface can accept its intended interactions, in ms.
  interactive_ms REAL CHECK (interactive_ms BETWEEN 0 AND 600000),
  -- End of automatic non-map startup network activity, in ms.
  network_idle_ms REAL CHECK (network_idle_ms BETWEEN 0 AND 600000),
  -- Service-worker install readiness, in ms when applicable.
  service_worker_ready_ms REAL CHECK (service_worker_ready_ms BETWEEN 0 AND 600000),

  -- Largest Contentful Paint, in ms when the browser reported it.
  lcp_ms REAL CHECK (lcp_ms BETWEEN 0 AND 600000),
  -- Cumulative Layout Shift, dimensionless and bounded by the contract.
  cls REAL CHECK (cls BETWEEN 0 AND 10),
  -- Interaction to Next Paint, in ms when an interaction occurred.
  inp_ms REAL CHECK (inp_ms BETWEEN 0 AND 600000),

  -- Encoded first-party application response bytes.
  first_party_app_bytes INTEGER CHECK (first_party_app_bytes BETWEEN 0 AND 1000000000),
  -- Encoded external map style/sprite/glyph/tile response bytes.
  external_map_bytes INTEGER CHECK (external_map_bytes BETWEEN 0 AND 1000000000),
  -- Encoded saved/shared transit document response bytes.
  document_data_bytes INTEGER CHECK (document_data_bytes BETWEEN 0 AND 1000000000),
  -- Encoded service-worker script and installation response bytes.
  service_worker_bytes INTEGER CHECK (service_worker_bytes BETWEEN 0 AND 1000000000),
  -- Encoded bytes for this first-party telemetry submission itself.
  telemetry_bytes INTEGER CHECK (telemetry_bytes BETWEEN 0 AND 1000000000),
  -- Combined encoded automatic first-session bytes.
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 0 AND 1000000000),

  -- Coarse cold/warm/mixed state; no cache keys are stored.
  cache_state TEXT NOT NULL CHECK (
    cache_state IN ('cold', 'warm', 'mixed', 'unknown')
  ),
  -- Coarse service-worker lifecycle state; no registration URL is stored.
  service_worker_state TEXT NOT NULL CHECK (
    service_worker_state IN (
      'unsupported', 'unregistered', 'installing', 'waiting',
      'active-uncontrolled', 'controlled'
    )
  ),
  -- Coarse device capability tier; never a hardware model or user agent.
  device_tier TEXT NOT NULL CHECK (device_tier IN ('unknown', 'low', 'standard', 'high')),
  -- Coarse Network Information tier; never an address or provider name.
  network_tier TEXT NOT NULL CHECK (
    network_tier IN ('unknown', 'offline', 'data-saver', 'slow', 'moderate', 'fast')
  ),
  -- Fixed eight-bit feature-support mask; raw browser identity is forbidden.
  capability_bits INTEGER NOT NULL CHECK (capability_bits BETWEEN 0 AND 255),
  -- Observed categories cannot exceed the total. When every category was
  -- observable, their sum must equal it; nullable categories preserve an
  -- honest unknown instead of forcing the client to invent zero bytes.
  CHECK (
    COALESCE(first_party_app_bytes, 0) + COALESCE(external_map_bytes, 0) +
    COALESCE(document_data_bytes, 0) + COALESCE(service_worker_bytes, 0) +
    COALESCE(telemetry_bytes, 0) <= total_bytes AND (
      first_party_app_bytes IS NULL OR external_map_bytes IS NULL OR
      document_data_bytes IS NULL OR service_worker_bytes IS NULL OR
      telemetry_bytes IS NULL OR
      first_party_app_bytes + external_map_bytes + document_data_bytes +
      service_worker_bytes + telemetry_bytes = total_bytes
    )
  )
);

-- Supports bounded day discovery, rollup reads and seven-day raw retention.
CREATE INDEX idx_performance_samples_received_at ON performance_samples (received_at);
-- Supports the primary field comparison without scanning unrelated builds or
-- surfaces, while keeping receipt time available for retention bounds.
CREATE INDEX idx_performance_samples_build_surface_received
  ON performance_samples (build_id, surface, received_at);

-- One row per UTC day and anonymous comparison cohort. metrics_json is safe
-- here because it is generated server-side from a fixed metric registry; it
-- never contains caller-provided keys or a copy of the submitted JSON.
CREATE TABLE performance_daily_aggregates (
  -- UTC midnight in epoch milliseconds represented by this rollup.
  day_start INTEGER NOT NULL CHECK (day_start >= 0),
  -- Contract version, retained so incompatible versions never mix.
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  -- Release/build label used for regression comparisons.
  build_id TEXT NOT NULL CHECK (length(build_id) BETWEEN 1 AND 80),
  -- Editor/share/embed comparison dimension.
  surface TEXT NOT NULL CHECK (surface IN ('editor', 'share', 'embed')),
  -- Cold/warm/mixed comparison dimension.
  cache_state TEXT NOT NULL CHECK (
    cache_state IN ('cold', 'warm', 'mixed', 'unknown')
  ),
  -- Service-worker lifecycle comparison dimension.
  service_worker_state TEXT NOT NULL CHECK (
    service_worker_state IN (
      'unsupported', 'unregistered', 'installing', 'waiting',
      'active-uncontrolled', 'controlled'
    )
  ),
  -- Coarse device capability comparison dimension.
  device_tier TEXT NOT NULL CHECK (device_tier IN ('unknown', 'low', 'standard', 'high')),
  -- Coarse connection capability comparison dimension.
  network_tier TEXT NOT NULL CHECK (
    network_tier IN ('unknown', 'offline', 'data-saver', 'slow', 'moderate', 'fast')
  ),
  -- Eight-bit capability cohort, still anonymous and non-identifying.
  capability_bits INTEGER NOT NULL CHECK (capability_bits BETWEEN 0 AND 255),
  -- Total raw samples in this cohort, including samples with nullable metrics.
  sample_count INTEGER NOT NULL CHECK (sample_count > 0),
  -- Server-generated fixed-key object of per-metric
  -- {count,min,p50,p75,p95,max,mean} summaries.
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  -- Worker rollup completion time in epoch milliseconds.
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (
    day_start, schema_version, build_id, surface, cache_state,
    service_worker_state, device_tier, network_tier, capability_bits
  )
) WITHOUT ROWID;

-- Completion markers are written only after every metric upsert for a day
-- succeeds. They make retries idempotent without relying on D1 batch calls to
-- provide rollback semantics, and guard raw-row deletion after seven days.
CREATE TABLE performance_sample_aggregation_days (
  -- UTC midnight in epoch milliseconds for the completed rollup.
  day_start INTEGER PRIMARY KEY,
  -- Number of raw samples included, for operational reconciliation.
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  -- Worker completion time in epoch milliseconds.
  completed_at INTEGER NOT NULL CHECK (completed_at >= 0)
) WITHOUT ROWID;
