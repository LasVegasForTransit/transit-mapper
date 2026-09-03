import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createMapViewStore } from '@transitmapper/map';
import { MapViewProvider } from '@transitmapper/workspace';
import type { DocumentRepresentationId } from '@transitmapper/map/presentation';
import { createDocumentPresentationState } from '@transitmapper/map/presentation';
import { SidebarPanel } from '../../src/ui/SidebarPanel';
import {
  infrastructureOutlineProjection,
  sidebarSectionsForView,
} from '../../src/ui/sidebarOutline';

function renderSidebar(viewMode: DocumentRepresentationId = 'network'): string {
  const viewStore = createMapViewStore(
    createDocumentPresentationState({ representationId: viewMode }),
  );
  return renderToStaticMarkup(
    <EditorProvider>
      <MapViewProvider store={viewStore}>
        <SidebarPanel />
      </MapViewProvider>
    </EditorProvider>,
  );
}

describe('SidebarPanel', () => {
  it('renders Network sections in a view-specific labelled region', () => {
    const markup = renderSidebar();

    expect(markup).toContain('aria-label="Network outline"');
    expect(markup).toContain('Lines');
    expect(markup).toContain('Stops');
    expect(markup).not.toContain('Workspace');
    expect(markup).not.toContain('Corridors');
  });

  it('renders Infrastructure categories in a view-specific labelled region', () => {
    const markup = renderSidebar('infrastructure');

    expect(markup).toContain('aria-label="Infrastructure outline"');
    expect(markup).toContain('Stops');
    expect(markup).toContain('Facilities');
    expect(markup).not.toContain('Corridors');
    expect(markup).not.toContain('Workspace');
  });

  it('gives Diagram the network list rather than a second Layers control', () => {
    // Diagram is a schematic projection OF the network, so it shows the same
    // lines. It used to have a workspace of its own holding mode checkboxes
    // and a Landmarks toggle — the Layers control's, off the same
    // map View state — and on a phone both copies were on screen at once.
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
    expect(sidebarSectionsForView('network')).toEqual(['Lines', 'Stops', 'Stations']);
    expect(sidebarSectionsForView('infrastructure')).toEqual([
      'Roads',
      'Railways and guideways',
      'Trails',
      'Waterways',
      'Other infrastructure',
      'Stops',
      'Stations',
      'Facilities',
    ]);
    expect(sidebarSectionsForView('diagram')).toEqual(['Lines', 'Stops', 'Stations']);
  });

  it('projects Stations separately from their contained Stops', () => {
    const system = {
      ...createEmptySystem(1),
      stops: [
        {
          id: 'platform',
          name: 'Platform 1',
          coord: [-115.17, 36.12] as [number, number],
          anchors: [],
          stationId: 'central',
        },
      ],
      stations: [
        { id: 'central', name: 'Central Station', coord: [-115.17, 36.12] as [number, number] },
      ],
    };

    const projection = infrastructureOutlineProjection(system, '');

    expect(projection.stops.map((stop) => stop.id)).toEqual(['platform']);
    expect(projection.stations.map((station) => station.id)).toEqual(['central']);
  });
});
