// Named for the convention every other tool config in this repository follows
// — `<tool>.config.<ext>` — rather than `.prettierrc.json`. ESM rather than
// TypeScript because Prettier has no dependencies and loads no transpiler;
// `check:config` records that exemption.
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
};
