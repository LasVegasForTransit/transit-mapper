import type { RendererCaptureComparison } from '../../src/perf/renderer-capture';

export interface RendererContactSheetCapture {
  id: string;
  comparisons: RendererCaptureComparison[];
}

export interface RendererContactSheetOptions {
  phase: string;
  captures: RendererContactSheetCapture[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function rendererContactSheetHtml(options: RendererContactSheetOptions): string {
  const captures = options.captures
    .map(
      (capture) => `
        <section class="capture">
          <h2>${escapeHtml(capture.id)}</h2>
          <div class="comparisons">
            ${capture.comparisons
              .map(
                (comparison) => `
                  <figure>
                    <figcaption>${escapeHtml(comparison.label)}</figcaption>
                    <img src="${escapeHtml(comparison.path)}" alt="${escapeHtml(`${capture.id} ${comparison.label}`)}">
                  </figure>`,
              )
              .join('')}
          </div>
        </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Renderer evidence: ${escapeHtml(options.phase)}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
      h1 { margin: 0 0 24px; }
      .capture { margin-block: 32px; }
      .comparisons { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      figure { margin: 0; padding: 10px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 12px; }
      figcaption { margin-bottom: 8px; font-weight: 650; }
      img { display: block; width: 100%; height: auto; border-radius: 8px; background: #ddd; }
    </style>
  </head>
  <body>
    <h1>Renderer evidence: ${escapeHtml(options.phase)}</h1>
    ${captures}
  </body>
</html>
`;
}
