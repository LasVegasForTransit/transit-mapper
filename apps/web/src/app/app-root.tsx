import {
  Component,
  lazy,
  Suspense,
  useMemo,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { parseRouteIntent, type RouteIntent } from './route-intent';
import './app-root.css';

export interface RouteHostProps {
  routeIntent: RouteIntent;
}

export type RouteHostLoader = () => Promise<{ default: ComponentType<RouteHostProps> }>;

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
    routeIntent.kind === 'shared-system' ? loadViewerApplication : loadEditorApplication;
  const RouteHost = useMemo(() => lazy(routeHostLoader), [routeHostLoader]);

  return (
    <RouteErrorBoundary>
      <Suspense fallback={null}>
        <RouteHost routeIntent={routeIntent} />
      </Suspense>
    </RouteErrorBoundary>
  );
}
