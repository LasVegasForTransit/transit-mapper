import type { RendererCaptureComparison } from '../../src/perf/renderer-capture';

export interface RendererContactSheetCapture {
  id: string;
  description?: string;
  comparisons: RendererCaptureComparison[];
}

export interface RendererContactSheetAppendixVisual {
  id: string;
  description: string;
  path: string;
}

export interface RendererContactSheetAppendixAssertion {
  id: string;
  description: string;
  passed: boolean;
}

export interface RendererContactSheetAppendix {
  title: string;
  suiteId: string;
  manifestPath: string;
  visuals: RendererContactSheetAppendixVisual[];
  assertions: RendererContactSheetAppendixAssertion[];
}

export interface RendererContactSheetOptions {
  phase: string;
  captures: RendererContactSheetCapture[];
  appendix?: RendererContactSheetAppendix;
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
          ${capture.description ? `<p class="capture-metadata">${escapeHtml(capture.description)}</p>` : ''}
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
  const appendix = options.appendix
    ? `<section class="appendix">
        <h2>${escapeHtml(options.appendix.title)}</h2>
        <p class="capture-metadata">Suite ${escapeHtml(options.appendix.suiteId)} · <a href="${escapeHtml(options.appendix.manifestPath)}">Machine-readable manifest</a></p>
        <div class="appendix-visuals">
          ${options.appendix.visuals
            .map(
              (visual) => `<figure>
                <figcaption>${escapeHtml(visual.id)}</figcaption>
                <p class="capture-metadata">${escapeHtml(visual.description)}</p>
                <img src="${escapeHtml(visual.path)}" alt="${escapeHtml(`${visual.id} current acceptance frame`)}">
              </figure>`,
            )
            .join('')}
        </div>
        <h3>Machine assertions</h3>
        <ul class="appendix-assertions">
          ${options.appendix.assertions
            .map(
              (assertion) =>
                `<li><strong>${escapeHtml(assertion.id)}</strong> — ${assertion.passed ? 'Passed' : 'Failed'} · ${escapeHtml(assertion.description)}</li>`,
            )
            .join('')}
        </ul>
      </section>`
    : '';

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
      h2 { margin-bottom: 4px; }
      .capture { margin-block: 32px; }
      .capture-metadata { margin: 0 0 12px; color: color-mix(in srgb, CanvasText 72%, transparent); font-variant-numeric: tabular-nums; }
      .comparisons { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .appendix { margin-block: 64px 32px; padding-top: 32px; border-top: 2px solid color-mix(in srgb, CanvasText 30%, transparent); }
      .appendix-visuals { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .appendix-assertions { display: grid; gap: 8px; padding-left: 24px; }
      figure { margin: 0; padding: 10px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 12px; }
      figcaption { margin-bottom: 8px; font-weight: 650; }
      img { display: block; width: 100%; height: auto; border-radius: 8px; background: #ddd; }
    </style>
  </head>
  <body>
    <h1>Renderer evidence: ${escapeHtml(options.phase)}</h1>
    ${captures}
    ${appendix}
  </body>
</html>
`;
}
