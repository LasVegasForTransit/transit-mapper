// Repository tooling only: scripts/, turbo/, and this file. Each package lints
// itself with its own eslint.config.ts, which ESLint reaches first because it
// resolves the nearest config to each file it lints. What every package
// shares lives in @transitmapper/eslint-plugin/configs.
import { configs } from '@transitmapper/eslint-plugin/configs';

export default configs.base;
