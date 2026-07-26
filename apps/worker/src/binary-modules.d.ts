// Font files are imported as raw bytes and handed to resvg. Wrangler turns
// them into ArrayBuffer modules via the `Data` rule in wrangler.toml; this
// tells TypeScript the same thing.
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
