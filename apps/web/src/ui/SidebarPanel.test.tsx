import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorProvider } from '../editor/EditorProvider';
import { SidebarPanel } from './SidebarPanel';
import { sidebarSectionsForView } from './sidebarOutline';
import { ViewProvider, type ViewMode } from './ViewProvider';

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
  it('renders the Network workspace with grouping and a vehicle placeholder', () => {
    const markup = renderSidebar();

    expect(markup).toContain('Group by');
    expect(markup).toContain('Lines');
    expect(markup).toContain('Corridors');
    expect(markup).toContain('Vehicles');
    expect(markup).toContain('Coming later');
    expect(markup).not.toContain('Infrastructure');
  });

  it('renders the Infrastructure workspace instead of unused object categories', () => {
    const markup = renderSidebar('infrastructure');

    expect(markup).toContain('Infrastructure');
    expect(markup).toContain('Corridors');
    expect(markup).toContain('Stations');
    expect(markup).toContain('Complexes and facilities');
    expect(markup).not.toContain('Group by');
    expect(markup).not.toContain('Vehicles');
  });

  it('renders Diagram presentation controls as the sidebar workspace', () => {
    const markup = renderSidebar('diagram');

    expect(markup).toContain('Diagram');
    expect(markup).toContain('Services');
    expect(markup).toContain('Reference');
    expect(markup).toContain('Landmarks');
    expect(markup).not.toContain('Group by');
  });

  it('uses native controls in a labelled region rather than nesting controls in a listbox', () => {
    const markup = renderSidebar();

    expect(markup).toContain('role="region"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });

  it('assigns each view its expected workspace sections', () => {
    expect(sidebarSectionsForView('network')).toEqual(['Lines', 'Vehicles']);
    expect(sidebarSectionsForView('infrastructure')).toEqual([
      'Corridors',
      'Stations',
      'Complexes and facilities',
    ]);
    expect(sidebarSectionsForView('diagram')).toEqual(['Services', 'Reference']);
  });
});
