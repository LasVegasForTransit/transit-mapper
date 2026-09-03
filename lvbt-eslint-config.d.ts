// @lvbt/eslint-config ships plain JavaScript with JSDoc types and no
// declaration files, which resolves to an implicit `any` under this
// repository's strict, allowJs-off TypeScript config. This restores the
// real type for the one entry point eslint.config.ts consumes.
declare module '@lvbt/eslint-config/base' {
  import type { Linter } from 'eslint';

  export const config: Linter.Config[];
}
