import type { Page } from 'playwright-core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  captureBareRenderer,
  fixtureCenter,
  selectView,
  waitForSettledRenderer,
} from '../../scripts/renderer-capture/capture-browser';
import { createRendererFixture } from '../../src/perf/renderer-fixtures';

interface FakeCaptureElement {
  attributes: Set<string>;
  removeAttribute(name: string): void;
  setAttribute(name: string): void;
}

function fakeCaptureElement(): FakeCaptureElement {
  const attributes = new Set<string>();
  return {
    attributes,
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name) => attributes.add(name),
  };
}

async function renderedCapturePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 160,
      height: 80,
      channels: 4,
      background: { r: 247, g: 244, b: 236, alpha: 1 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 160,
            height: 2,
            channels: 4,
            background: { r: 25, g: 26, b: 23, alpha: 1 },
          },
        },
        top: 40,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

describe('renderer capture browser lifecycle', () => {
  it('uses the fixture camera on real geometry at every detail tier', () => {
    const system = createRendererFixture('port-mason');
    const center = fixtureCenter(system);

    expect(center).toEqual(system.viewport.center);
    expect(
      system.ways.some((way) =>
        way.points.some((point) => point[0] === center[0] && point[1] === center[1]),
      ),
    ).toBe(true);
  });

  it('isolates the map while capturing and restores the application afterward', async () => {
    const app = fakeCaptureElement();
    const screenshotAttributes: string[][] = [];
    const injectedStyles: string[] = [];
    const page = {
      addStyleTag: ({ content }: { content: string }) => {
        injectedStyles.push(content);
        return Promise.resolve();
      },
      evaluate: () => Promise.resolve(),
      locator: (selector: string) => {
        if (selector === '.app') {
          return {
            evaluate: (callback: (element: FakeCaptureElement) => void) => {
              callback(app);
              return Promise.resolve();
            },
          };
        }
        if (selector === '.maplibregl-map') {
          return {
            screenshot: async () => {
              screenshotAttributes.push([...app.attributes]);
              return renderedCapturePng();
            },
          };
        }
        throw new Error(`Unexpected locator: ${selector}`);
      },
    } as unknown as Page;

    await captureBareRenderer(page, '/tmp/renderer.png');

    expect(screenshotAttributes).toEqual([['data-renderer-capture-bare']]);
    expect(injectedStyles.join('\n')).toContain(
      '.app[data-renderer-capture-bare] > :not(.maplibregl-map)',
    );
    expect(injectedStyles.join('\n')).toContain('background-image:none!important');
    expect(app.attributes).not.toContain('data-renderer-capture-bare');
  });

  it('waits for a visible renderer-owned settlement marker instead of elapsed time', async () => {
    const waits: Array<{ selector: string; options: unknown }> = [];
    const page = {
      addStyleTag: () => Promise.resolve(),
      evaluate: () => Promise.resolve(),
      locator: (selector: string) => ({
        waitFor: (options: unknown) => {
          waits.push({ selector, options });
          return Promise.resolve();
        },
      }),
    } as unknown as Page;

    await waitForSettledRenderer(page, '.maplibregl-map');

    expect(waits).toEqual([
      {
        selector: '.maplibregl-map[data-render-settled="true"]',
        options: { state: 'visible', timeout: 60_000 },
      },
    ]);
  });

  it('uses the compact view menu when a desktop capture viewport has collapsed it', async () => {
    const clicked: string[] = [];
    const page = {
      getByRole: (role: string, options: { name?: string | RegExp }) => {
        if (role === 'group') {
          return {
            getByRole: () => ({ count: () => Promise.resolve(0) }),
          };
        }
        if (role === 'button') {
          return {
            getAttribute: () => Promise.resolve('View: Network'),
            click: () => {
              clicked.push('trigger');
              return Promise.resolve();
            },
          };
        }
        if (role === 'menuitemradio') {
          return {
            click: () => {
              clicked.push(String(options.name));
              return Promise.resolve();
            },
          };
        }
        throw new Error(`Unexpected role: ${role}`);
      },
    } as unknown as Page;

    await selectView(page, {
      profile: 'desktop',
      controls: 'compact',
      viewMode: 'infrastructure',
    });

    expect(clicked).toEqual(['trigger', 'Infrastructure']);
  });
});
