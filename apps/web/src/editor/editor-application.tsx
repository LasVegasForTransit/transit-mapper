import { useState } from 'react';
import { createMapViewStore } from '@transitmapper/map';
import { MapViewProvider } from '@transitmapper/workspace';
import { createDocumentPresentationState } from '@transitmapper/map/presentation';
import { EditorSession } from '../App';
import { InstallProvider } from '../pwa/InstallProvider';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { SaveStatusProvider } from '../ui/SaveStatusProvider';
import { SimProvider } from '../ui/SimProvider';
import { UiProvider } from '../ui/UiProvider';
import { currentDocumentCamera } from './document-view-adapter';
import { EditorProvider } from './EditorProvider';
import { createEditorStore } from './store';

/** Own one editor session, including its stores and every browser integration
 * that must stay out of the eager application-shell closure. */
export default function EditorApplication() {
  const [mapViewStore] = useState(() => createMapViewStore(createDocumentPresentationState()));
  const [editorStore] = useState(() =>
    createEditorStore({
      documentStatus: 'loading',
      readCameraCenter: () => currentDocumentCamera(mapViewStore).center,
    }),
  );

  return (
    <ErrorBoundary label="editor">
      <EditorProvider store={editorStore}>
        <InstallProvider enabled>
          <UiProvider>
            <SaveStatusProvider>
              <MapViewProvider store={mapViewStore}>
                <SimProvider>
                  <EditorSession />
                </SimProvider>
              </MapViewProvider>
            </SaveStatusProvider>
          </UiProvider>
        </InstallProvider>
      </EditorProvider>
    </ErrorBoundary>
  );
}
