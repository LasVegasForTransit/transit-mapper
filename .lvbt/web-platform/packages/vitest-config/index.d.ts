/**
 * The shared Vitest configuration; spread it into `defineConfig({ ...sharedConfig })`.
 * Declared structurally rather than as Vitest's UserConfig so the type never
 * depends on which Vite version a consumer happens to resolve.
 */
export declare const sharedConfig: {
  test: {
    include: string[];
    exclude: string[];
    passWithNoTests: boolean;
  };
};
