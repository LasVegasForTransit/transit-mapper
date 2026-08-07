import { describe, expect, it } from 'vitest';
import { defineConfig, defineTypeAwareConfig } from '../src/index.ts';

interface ParserOptionsCarrier {
  languageOptions?: { parserOptions?: { projectService?: unknown; tsconfigRootDir?: unknown } };
}

function parserOptionsOf(config: unknown[]): ParserOptionsCarrier['languageOptions'][] {
  return config
    .map((entry) => (entry as ParserOptionsCarrier).languageOptions)
    .filter((options): options is NonNullable<ParserOptionsCarrier['languageOptions']> =>
      Boolean(options?.parserOptions),
    );
}

function ruleNames(config: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const entry of config) {
    const rules = (entry as { rules?: Record<string, unknown> }).rules;
    for (const name of Object.keys(rules ?? {})) names.add(name);
  }
  return names;
}

describe('defineTypeAwareConfig', () => {
  it('points the project service at the directory it was given', () => {
    const found = parserOptionsOf(defineTypeAwareConfig('/somewhere/repo')).filter(
      (options) => options?.parserOptions?.projectService === true,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.parserOptions?.tsconfigRootDir).toBe('/somewhere/repo');
  });

  it('enables the rules that need a type checker', () => {
    const names = ruleNames(defineTypeAwareConfig('/somewhere/repo'));
    expect(names).toContain('@typescript-eslint/no-floating-promises');
    expect(names).toContain('@typescript-eslint/no-unnecessary-condition');
  });

  it('places a caller override after the baseline so it wins', () => {
    const marker = { rules: { 'no-console': 'error' } } as const;
    const config = defineTypeAwareConfig('/somewhere/repo', marker);
    const positions = config.map((entry) =>
      Object.keys((entry as { rules?: Record<string, unknown> }).rules ?? {}),
    );
    const overrideAt = positions.findIndex((names) => names.includes('no-console'));
    const baselineAt = positions.findIndex((names) =>
      names.includes('@typescript-eslint/no-namespace'),
    );
    expect(overrideAt).toBeGreaterThan(baselineAt);
  });
});

describe('defineConfig', () => {
  it('leaves the project service off, so it runs without a covering tsconfig', () => {
    const withService = parserOptionsOf(defineConfig()).filter(
      (options) => options?.parserOptions?.projectService === true,
    );
    expect(withService).toHaveLength(0);
  });

  it('does not enable rules that would need a type checker', () => {
    expect(ruleNames(defineConfig())).not.toContain('@typescript-eslint/no-floating-promises');
  });
});
