/** Pure governance comparisons kept separate from GitHub API calls. */

export function settingDrift<T, U>(
  current: Readonly<Record<string, T | undefined>>,
  desired: Readonly<Record<string, U>>,
  value: (current: T | undefined) => unknown = (entry) => entry,
): string[] {
  return Object.entries(desired)
    .filter(([key, wanted]) => value(current[key]) !== wanted)
    .map(([key]) => key);
}

interface EndpointResult {
  ok: boolean;
  error: string;
}

export type BooleanEndpointState = 'enabled' | 'disabled' | 'unreadable';

/** GitHub's vulnerability-alerts endpoint uses success for on and 404 for off. */
export function booleanEndpointState(result: EndpointResult): BooleanEndpointState {
  if (result.ok) return 'enabled';
  return /\bHTTP 404\b/.test(result.error) ? 'disabled' : 'unreadable';
}

interface CurrentActionsPolicy {
  enabled?: unknown;
  allowed_actions?: unknown;
  sha_pinning_required?: unknown;
}

interface ActionsPolicyBody {
  enabled: true;
  allowed_actions?: 'all' | 'local_only' | 'selected';
  sha_pinning_required: true;
}

/**
 * The update endpoint requires `enabled`; carrying the current allow policy
 * prevents a SHA-pinning repair from widening or narrowing which actions run.
 */
export function actionsPolicyBody(current: CurrentActionsPolicy): ActionsPolicyBody {
  const allowed =
    current.allowed_actions === 'all' ||
    current.allowed_actions === 'local_only' ||
    current.allowed_actions === 'selected'
      ? current.allowed_actions
      : undefined;
  return {
    enabled: true,
    ...(allowed ? { allowed_actions: allowed } : {}),
    sha_pinning_required: true,
  };
}
