import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EditorProvider } from './editor/EditorProvider';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SaveStatusProvider } from './ui/SaveStatusProvider';
import { SimProvider } from './ui/SimProvider';
import { UiProvider } from './ui/UiProvider';
import { ViewProvider } from './ui/ViewProvider';
import { InstallProvider } from './pwa/InstallProvider';

// Outermost boundary: the last thing between a render error anywhere in the
// editor and a white page. It cannot save the unsaved work — by the time it
// runs, the tree is already coming down — but it can say what happened instead
// of leaving someone staring at nothing, wondering whether to reload and lose
// more. The per-dialog boundaries in App.tsx catch the common case before it
// ever reaches this one.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="editor">
      <EditorProvider>
        <InstallProvider enabled={!window.location.pathname.startsWith('/s/')}>
          <UiProvider>
            <SaveStatusProvider>
              <ViewProvider>
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
