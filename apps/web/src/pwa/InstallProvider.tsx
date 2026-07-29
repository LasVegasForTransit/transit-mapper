import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createBrowserInstallEnvironment,
  createInstallController,
  shouldRegisterInstallController,
  type InstallController,
  type InstallState,
} from './install';

const InstallContext = createContext<InstallController | null>(null);

export interface InstallProviderProps {
  children: ReactNode;
  /** The main entry also serves read-only shares, which must never retain an
   *  install prompt. embed.html never mounts this provider at all. */
  enabled: boolean;
}

export function InstallProvider({ children, enabled }: InstallProviderProps) {
  const controller = useMemo(() => createInstallController(createBrowserInstallEnvironment()), []);

  useEffect(() => {
    if (
      !shouldRegisterInstallController({
        enabled,
        permanentlySuppressed: controller.state().permanentlySuppressed,
      })
    ) {
      return;
    }
    const stop = controller.start();
    const promptDeadline = window.setTimeout(() => controller.refresh(), 90_000);
    const onResize = () => controller.refresh();
    window.addEventListener('resize', onResize);
    return () => {
      stop();
      window.clearTimeout(promptDeadline);
      window.removeEventListener('resize', onResize);
    };
  }, [controller, enabled]);

  return <InstallContext.Provider value={controller}>{children}</InstallContext.Provider>;
}

function useInstallController(): InstallController {
  const controller = useContext(InstallContext);
  if (!controller) throw new Error('useInstall must be used within InstallProvider');
  return controller;
}

export function useInstall(): InstallController & { installState: InstallState } {
  const controller = useInstallController();
  const installState = useSyncExternalStore(
    controller.subscribe,
    controller.state,
    controller.state,
  );
  return { ...controller, installState };
}
