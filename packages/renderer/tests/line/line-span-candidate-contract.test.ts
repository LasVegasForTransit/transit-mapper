import { describe, expectTypeOf, it } from 'vitest';
import type {
  LineSpanCandidate,
  ValidatedLineSpanCandidates,
} from '../../src/line/line-span-candidates';

describe('validated Line span candidates', () => {
  it('keeps raw candidate arrays outside exact-carrier derivation', () => {
    expectTypeOf<readonly LineSpanCandidate[]>().not.toExtend<ValidatedLineSpanCandidates>();
    expectTypeOf<ValidatedLineSpanCandidates>().toExtend<readonly LineSpanCandidate[]>();
  });
});
