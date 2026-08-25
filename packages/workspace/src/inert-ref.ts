import { useEffect, useRef } from 'react';

export function useInertRef<T extends HTMLElement>(inert: boolean) {
  const element = useRef<T | null>(null);
  useEffect(() => {
    if (element.current) element.current.inert = inert;
  }, [inert]);
  return element;
}
