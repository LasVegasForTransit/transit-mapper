import { expect, test } from 'vitest';
import { exactReleaseTag } from '../../scripts/release-tag';
const commit = 'a'.repeat(40);
test('only a package-version tag resolving to the exact retained source can label a release build', () => {
  expect(exactReleaseTag('0.11.1', commit, `${commit}\trefs/tags/v0.11.1\n`)).toBe('v0.11.1');
  expect(
    exactReleaseTag(
      '0.11.1',
      commit,
      `${'b'.repeat(40)}\trefs/tags/v0.11.1\n${commit}\trefs/tags/v0.11.1^{}\n`,
    ),
  ).toBe('v0.11.1');
  expect(exactReleaseTag('0.11.1', commit, `${'b'.repeat(40)}\trefs/tags/v0.11.1\n`)).toBeNull();
  expect(exactReleaseTag('0.11.1', commit, `${commit}\trefs/tags/v0.11.2\n`)).toBeNull();
  expect(exactReleaseTag('0.11.1', commit, '')).toBeNull();
});
