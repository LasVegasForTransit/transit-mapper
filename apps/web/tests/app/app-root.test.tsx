// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoot, type RouteHostLoader, type RouteHostProps } from '../../src/app/app-root';

const editorHostModule = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock('../../src/editor/editor-application', () => {
  editorHostModule.evaluations += 1;
  return {
    default: ({ routeIntent }: RouteHostProps) => (
      <div data-testid="editor-host">{routeIntent.kind}</div>
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('AppRoot', () => {
  it('establishes viewport geometry before the route host resolves', () => {
    container.id = 'root';
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(process.cwd(), 'src/app/app-root.css'), 'utf8');
    document.head.append(style);

    expect(getComputedStyle(document.documentElement).height).toBe('100%');
    expect(getComputedStyle(document.body).height).toBe('100%');
    expect(getComputedStyle(document.body).margin).toBe('0px');
    expect(getComputedStyle(container).height).toBe('100%');

    style.remove();
  });

  it('does not block the page with a loading screen while the route host resolves', async () => {
    let resolveHost: ((module: { default: ComponentType<RouteHostProps> }) => void) | undefined;
    const loadHost: RouteHostLoader = () =>
      new Promise((resolve) => {
        resolveHost = resolve;
      });

    act(() => root.render(<AppRoot pathname="/" loadEditorApplication={loadHost} />));

    expect(container.childElementCount).toBe(0);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain('Loading TransitMapper');

    await act(async () => {
      resolveHost?.({ default: ({ routeIntent }) => <div>{routeIntent.kind}</div> });
      await Promise.resolve();
    });

    expect(container.textContent).toBe('editor');
  });

  it('passes a shared-system intent to the editor host until a viewer exists', async () => {
    let received: RouteHostProps['routeIntent'] | undefined;
    const loadHost: RouteHostLoader = () =>
      Promise.resolve({
        default: ({ routeIntent }) => {
          received = routeIntent;
          return <div>Shared system host</div>;
        },
      });

    await act(() => {
      root.render(<AppRoot pathname="/s/abc123/" loadEditorApplication={loadHost} />);
      return Promise.resolve();
    });

    expect(received).toEqual({ kind: 'shared-system', shareId: 'abc123' });
    expect(container.textContent).toBe('Shared system host');
  });

  it('loads the concrete editor host only after AppRoot renders', async () => {
    expect(editorHostModule.evaluations).toBe(0);

    await act(() => {
      root.render(<AppRoot pathname="/" />);
      return Promise.resolve();
    });

    expect(editorHostModule.evaluations).toBe(1);
    expect(container.querySelector('[data-testid="editor-host"]')?.textContent).toBe('editor');
  });
});
