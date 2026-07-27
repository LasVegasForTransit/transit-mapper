#!/usr/bin/env tsx
/**
 * Runs from `postinstall`. Records which pnpm-lock.yaml produced the
 * node_modules tree that now exists, so `pnpm doctor` can tell whether the
 * tree has since gone stale.
 */
import { recordLockfileHash } from './doctor.js';

await recordLockfileHash();
