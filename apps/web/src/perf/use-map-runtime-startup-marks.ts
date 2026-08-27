import { useCallback, useEffect, useRef } from 'react';
import type { MapRuntime } from '@transitmapper/map';
import { attachMapRuntimeStartupMarks } from './startup-marks';

const detachNothing = () => {};

export function useMapRuntimeStartupMarks<ThemeId extends string>(
  onRuntimeChange?: (runtime: MapRuntime<ThemeId> | null) => void,
): (runtime: MapRuntime<ThemeId> | null) => void {
  const detachRef = useRef<() => void>(detachNothing);
  const listenerRef = useRef(onRuntimeChange);
  listenerRef.current = onRuntimeChange;

  useEffect(
    () => () => {
      detachRef.current();
      detachRef.current = detachNothing;
    },
    [],
  );

  return useCallback((runtime: MapRuntime<ThemeId> | null) => {
    detachRef.current();
    detachRef.current = runtime === null ? detachNothing : attachMapRuntimeStartupMarks(runtime);
    listenerRef.current?.(runtime);
  }, []);
}
