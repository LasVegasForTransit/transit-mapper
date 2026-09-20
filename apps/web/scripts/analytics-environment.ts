interface AnalyticsBuildEnvironment {
  LVBT_REQUIRE_ANALYTICS?: string;
  PUBLIC_LVBT_CWA_TOKEN?: string;
}

export function assertAnalyticsBuildEnvironment(environment: AnalyticsBuildEnvironment): void {
  if (environment.LVBT_REQUIRE_ANALYTICS === '1' && !environment.PUBLIC_LVBT_CWA_TOKEN?.trim()) {
    throw new Error('PUBLIC_LVBT_CWA_TOKEN is required for a production analytics build.');
  }
}
