export interface MediaEnvironment {
  narrow: boolean;
  short?: boolean;
  roomy?: boolean;
}

export function matchMediaFor(environment: MediaEnvironment): typeof window.matchMedia {
  const { narrow, short = narrow, roomy = !narrow } = environment;
  return (query: string) => ({
    matches: query.split(',').some((clause) => {
      if (clause.includes('max-width')) return narrow;
      if (clause.includes('max-height')) return short;
      if (clause.includes('min-width')) return roomy;
      return false;
    }),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}
