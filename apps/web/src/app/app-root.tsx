import { Component, lazy, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { parseRouteIntent } from './route-intent';
import type { RouteHostLoader } from './route-host';
import './app-root.css';

export type { RouteHostLoader, RouteHostProps } from './route-host';

export interface AppRootProps {
  pathname?: string;
  loadEditorApplication?: RouteHostLoader;
  loadViewerApplication?: RouteHostLoader;
}

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  failed: boolean;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The application failed to load:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="application-error-shell" role="alert">
        <p>TransitMapper couldn’t open. Reload the page to try again.</p>
      </main>
    );
  }
}

const loadConcreteEditorApplication: RouteHostLoader = () => import('../editor/editor-application');
const loadConcreteViewerApplication: RouteHostLoader = () => import('../viewer/viewer-application');

/** Resolve the route before mounting its lazy application host. */
export function AppRoot({
  pathname,
  loadEditorApplication = loadConcreteEditorApplication,
  loadViewerApplication = loadConcreteViewerApplication,
}: AppRootProps) {
  const routeIntent = useMemo(
    () => parseRouteIntent(pathname ?? window.location.pathname),
    [pathname],
  );
  const routeHostLoader =
    routeIntent.kind === 'editor' ? loadEditorApplication : loadViewerApplication;
  const RouteHost = useMemo(() => lazy(routeHostLoader), [routeHostLoader]);

  return (
    <RouteErrorBoundary>
      <Suspense fallback={null}>
        <RouteHost routeIntent={routeIntent} />
      </Suspense>
    </RouteErrorBoundary>
  );
}
