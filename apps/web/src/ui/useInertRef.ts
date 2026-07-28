import { useEffect, useRef } from 'react';

/**
 * React DOM 18.x (this repo's pinned version) drops the `inert` JSX
 * attribute silently — it isn't in its attribute whitelist yet, so
 * `<div inert={true} />` renders no attribute at all. Setting the DOM IDL
 * property directly through a ref sidesteps that; this hook keeps it in
 * sync with `inert` on every render.
 */
export function useInertRef<T extends HTMLElement>(inert: boolean) {
  const elRef = useRef<T | null>(null);
  useEffect(() => {
    if (elRef.current) elRef.current.inert = inert;
  }, [inert]);
  return elRef;
}
