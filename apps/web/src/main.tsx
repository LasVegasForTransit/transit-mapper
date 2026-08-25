import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMapViewStore } from '@transitmapper/map';
import { App } from './App';
import { EditorProvider } from './editor/EditorProvider';
import { createEditorStore } from './editor/store';
import {
  createDocumentPresentationState,
  currentDocumentCamera,
} from './editor/document-view-adapter';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SaveStatusProvider } from './ui/SaveStatusProvider';
import { SimProvider } from './ui/SimProvider';
import { UiProvider } from './ui/UiProvider';
import { ViewProvider } from './ui/ViewProvider';
import { InstallProvider } from './pwa/InstallProvider';
import { BOOTSTRAP_START_MARK, markOnce } from './perf/startup-marks';
import { startFieldSampling } from './perf/field-sampling';
import { performanceSurfaceForPath } from './perf/field-sampling-policy';
import './theme/font.css';

markOnce(BOOTSTRAP_START_MARK);
startFieldSampling(performanceSurfaceForPath(window.location.pathname));

// Outermost boundary: the last thing between a render error anywhere in the
// editor and a white page. It cannot save the unsaved work — by the time it
// runs, the tree is already coming down — but it can say what happened instead
// of leaving someone staring at nothing, wondering whether to reload and lose
// more. The per-dialog boundaries in App.tsx catch the common case before it
// ever reaches this one.
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Editor root element is missing');
const mapViewStore = createMapViewStore(createDocumentPresentationState());
const editorStore = createEditorStore({
  documentStatus: 'loading',
  readCameraCenter: () => currentDocumentCamera(mapViewStore).center,
});
createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary label="editor">
      <EditorProvider store={editorStore}>
        <InstallProvider enabled={!window.location.pathname.startsWith('/s/')}>
          <UiProvider>
            <SaveStatusProvider>
              <ViewProvider store={mapViewStore}>
                <SimProvider>
                  <App />
                </SimProvider>
              </ViewProvider>
            </SaveStatusProvider>
          </UiProvider>
        </InstallProvider>
      </EditorProvider>
    </ErrorBoundary>
  </StrictMode>,
);
