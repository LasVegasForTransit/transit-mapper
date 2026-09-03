// Named for the convention every other tool config in this repository follows
// — `<tool>.config.<ext>` — rather than `.prettierrc.json`. ESM rather than
// TypeScript because Prettier has no dependencies and loads no transpiler;
// `check:config` records that exemption.
import lvbtConfig from '@lvbt/prettier-config';

export default {
  ...lvbtConfig,
  // The org default wraps prose (including every Markdown file under docs/)
  // at printWidth. Adopting that here would reformat hundreds of unrelated
  // files as a side effect of a tooling change; keep Prettier's own default
  // until that's a deliberate decision on its own.
  proseWrap: 'preserve',
};
