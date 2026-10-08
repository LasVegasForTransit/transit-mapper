export interface LocalFinding {
  ok: boolean;
  warning?: boolean;
  label: string;
  detail: string;
  fix?: string;
}
export declare function localEnvironment(
  cwd: string,
  options?: { apply?: boolean },
): LocalFinding[];
