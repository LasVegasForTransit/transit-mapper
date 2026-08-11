# Local MapLibre glyphs

These protocol-buffer glyph ranges come from the `gh-pages` branch of
[`openmaptiles/fonts`](https://github.com/openmaptiles/fonts) at commit
`025ff2b2f84cc0fdf11f7b1d74b3a784595fe7a4`.

The upstream directories are named `Klokantech Noto Sans Regular` and
`Klokantech Noto Sans Bold`. TransitMapper serves the same bytes under the
font-stack names used by its renderer, `Noto Sans Regular` and
`Noto Sans Bold`. Only the directory aliases changed; the PBF files did not.

All 256 Basic Multilingual Plane ranges are retained so imported place and
station names do not lose international text. MapLibre requests one 256-code
point range for a font stack only when rendered text needs it. The offline
editor precaches only Regular 0–255, Bold 0–255, and Regular 9472–9727: the
three ranges needed by the renderer's Latin labels and arrow glyphs total
185,909 bytes. Every other range remains on demand and is cached individually
after use, so the complete 7.3 MiB BMP fallback is not installed up front.

The font and generated glyph data are covered by the SIL Open Font License in
[`LICENSE.txt`](LICENSE.txt).
