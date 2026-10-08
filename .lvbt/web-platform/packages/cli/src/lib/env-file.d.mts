export function parseEnvFile(filePath: string): Map<string, string>;
export function mergeEnvFile(filePath: string, updates: Map<string, string>): boolean;
export function loadEnvFile(
  filePath: string,
  environment?: Record<string, string | undefined>,
): void;
export function loadEnvLocal(
  projectRoot: string,
  environment?: Record<string, string | undefined>,
): void;
