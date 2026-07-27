// packages/pwa-updater's source is type-checked as part of THIS app's own `tsc -b`
// run (no project-reference boundary between them), so its tsconfig's own
// `types` doesn't carry over here — this app needs the same ambient
// reference independently for `virtual:pwa-register/react` to resolve.
/// <reference types="vite-plugin-pwa/client" />
