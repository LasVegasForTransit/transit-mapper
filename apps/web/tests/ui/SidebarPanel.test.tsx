import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { SidebarPanel } from '../../src/ui/SidebarPanel';
import { sidebarSectionsForView } from '../../src/ui/sidebarOutline';
import { ViewProvider, type ViewMode } from '../../src/ui/ViewProvider';

function renderSidebar(viewMode: ViewMode = 'network'): string {
  return renderToStaticMarkup(
    <EditorProvider>
      <ViewProvider initialViewMode={viewMode}>
        <SidebarPanel />
      </ViewProvider>
    </EditorProvider>,
  );
}

describe('SidebarPanel', () => {
  it('renders Network sections in a view-specific labelled region', () => {
    const markup = renderSidebar();

    expect(markup).toContain('aria-label="Network outline"');
    expect(markup).toContain('Lines');
    expect(markup).toContain('Stations');
    expect(markup).not.toContain('Workspace');
    expect(markup).not.toContain('Corridors');
  });

  it('renders Infrastructure categories in a view-specific labelled region', () => {
    const markup = renderSidebar('infrastructure');

    expect(markup).toContain('aria-label="Infrastructure outline"');
    expect(markup).toContain('Stations');
    expect(markup).toContain('Facilities');
    expect(markup).not.toContain('Corridors');
    expect(markup).not.toContain('Workspace');
  });

  it('gives Diagram the network list rather than a second Layers control', () => {
    // Diagram is a schematic projection OF the network, so it shows the same
    // lines. It used to have a workspace of its own holding mode checkboxes
    // and a Landmarks toggle — the Layers control's, off the same
    // ViewProvider state — and on a phone both copies were on screen at once.
    const markup = renderSidebar('diagram');

    expect(markup).toContain('Diagram');
    expect(markup).toContain('Lines');
    expect(markup).not.toContain('Landmarks');
  });

  it('uses native controls in a labelled region rather than nesting controls in a listbox', () => {
    const markup = renderSidebar();

    expect(markup).toContain('role="region"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });

  it('assigns each view its expected workspace sections', () => {
    expect(sidebarSectionsForView('network')).toEqual(['Lines', 'Stations']);
    expect(sidebarSectionsForView('infrastructure')).toEqual([
      'Roads',
      'Railways and guideways',
      'Trails',
      'Waterways',
      'Other infrastructure',
      'Stations',
      'Facilities',
    ]);
    expect(sidebarSectionsForView('diagram')).toEqual(['Lines', 'Stations']);
  });
});
