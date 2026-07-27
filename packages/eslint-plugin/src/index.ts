import { coreRuntimePurity } from './core-runtime-purity.ts';

/**
 * Repository-specific rules. Each one exists because it encodes something
 * AGENTS.md used to only assert in prose, and that the compiler cannot
 * express on its own.
 */
export const rules = {
  'core-runtime-purity': coreRuntimePurity,
};

export default { rules };
