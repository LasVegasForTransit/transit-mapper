import { describe, expect, it } from 'vitest';

import { renderIssueBody, renderPullRequestBody, validateMetadata } from '../src/validation.js';

const validBugSections = {
  reproduction: 'Open the File menu from the upper application toolbar.',
  expected: 'The menu opens and its actions can be selected normally.',
  actual: 'The trigger does not react to either a pointer or the keyboard.',
  evidence: '',
};

const validIdeaSections = {
  goal: 'Let riders compare the service frequency of two saved networks.',
  'current-blocker': 'The editor currently shows only one simulation timeline.',
  examples: '',
};

const validPullRequestSections = {
  summary: 'Restore pointer and keyboard activation for every shared menu trigger.',
  reason: 'A global closed-state selector also matched controls that were not surfaces.',
  verification: 'Ran pnpm check and exercised the affected menus at both layout widths.',
  followups: '',
};

describe('GitHub metadata validation', () => {
  it('accepts a bug report whose required sections contain natural prose', () => {
    const body = renderIssueBody({
      template: 'bug',
      sections: validBugSections,
    });

    expect(validateMetadata({ kind: 'issue', title: 'File menu does not open', body })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects an untouched required section even when its prompt is present', () => {
    const body = renderIssueBody({
      template: 'bug',
      sections: { ...validBugSections, reproduction: '' },
    });

    expect(validateMetadata({ kind: 'issue', title: 'File menu does not open', body })).toEqual({
      valid: false,
      errors: [
        {
          code: 'section_too_short',
          field: 'reproduction',
          message: 'The reproduction section must contain at least 20 non-whitespace characters.',
        },
      ],
    });
  });

  it('accepts an idea and an ordinary pull request with all required prose', () => {
    const idea = renderIssueBody({ template: 'idea', sections: validIdeaSections });
    const pullRequest = renderPullRequestBody({ sections: validPullRequestSections });

    expect(
      validateMetadata({ kind: 'issue', title: 'Compare network frequency', body: idea }),
    ).toEqual({ valid: true, errors: [] });
    expect(
      validateMetadata({
        kind: 'pull-request',
        title: 'fix(ui): restore menu activation',
        body: pullRequest,
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['missing', (body: string) => body.replace('<!-- transitmapper:expected:start -->', '')],
    [
      'duplicated',
      (body: string) =>
        body.replace(
          '<!-- transitmapper:expected:start -->',
          '<!-- transitmapper:expected:start -->\n<!-- transitmapper:expected:start -->',
        ),
    ],
    [
      'reordered',
      (body: string) =>
        body
          .replace('<!-- transitmapper:expected:start -->', '<!-- transitmapper:swap-marker -->')
          .replace('<!-- transitmapper:actual:start -->', '<!-- transitmapper:expected:start -->')
          .replace('<!-- transitmapper:swap-marker -->', '<!-- transitmapper:actual:start -->'),
    ],
    [
      'malformed',
      (body: string) =>
        body.replace('<!-- transitmapper:expected:end -->', '<!-- transitmapper:wat -->'),
    ],
  ])('rejects %s section markers', (_case, mutate) => {
    const body = mutate(renderIssueBody({ template: 'bug', sections: validBugSections }));

    const result = validateMetadata({ kind: 'issue', title: 'File menu does not open', body });

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.field === 'expected' || error.field === 'body'),
    ).toBe(true);
  });

  it('rejects required prose made only of HTML comments and whitespace', () => {
    const body = renderPullRequestBody({
      sections: { ...validPullRequestSections, summary: '<!-- still a prompt -->   \n' },
    });

    const result = validateMetadata({
      kind: 'pull-request',
      title: 'fix(ui): restore menu activation',
      body,
    });

    expect(result.errors).toContainEqual({
      code: 'section_too_short',
      field: 'summary',
      message: 'The summary section must contain at least 20 non-whitespace characters.',
    });
  });

  it.each([
    ['short', 'Tiny bug', 'title_too_short'],
    ['long', 'A'.repeat(121), 'title_too_long'],
    ['placeholder', 'Bug report', 'placeholder_title'],
    ['untrimmed', ' File menu does not open', 'title_not_trimmed'],
  ])('rejects a %s issue title', (_case, title, code) => {
    const body = renderIssueBody({ template: 'bug', sections: validBugSections });

    const result = validateMetadata({ kind: 'issue', title, body });

    expect(result.errors.some((error) => error.code === code && error.field === 'title')).toBe(
      true,
    );
  });

  it('accepts the issue title length boundaries', () => {
    const body = renderIssueBody({ template: 'bug', sections: validBugSections });

    expect(validateMetadata({ kind: 'issue', title: 'A valid bug', body }).valid).toBe(true);
    expect(validateMetadata({ kind: 'issue', title: 'A'.repeat(120), body }).valid).toBe(true);
  });

  it.each([
    ['missing conventional prefix', 'Restore menu activation', 'invalid_title_format'],
    ['placeholder', 'fix: pull request', 'placeholder_title'],
    ['too long', `fix: ${'a'.repeat(68)}`, 'title_too_long'],
    ['untrimmed', ' fix: restore menu activation', 'title_not_trimmed'],
  ])('rejects a pull request title with a %s', (_case, title, code) => {
    const body = renderPullRequestBody({ sections: validPullRequestSections });

    const result = validateMetadata({ kind: 'pull-request', title, body });

    expect(result.errors.some((error) => error.code === code && error.field === 'title')).toBe(
      true,
    );
  });

  it('accepts a conventional pull request title at the 72-character boundary', () => {
    const body = renderPullRequestBody({ sections: validPullRequestSections });
    const title = `fix: ${'a'.repeat(67)}`;

    expect(title).toHaveLength(72);
    expect(validateMetadata({ kind: 'pull-request', title, body }).valid).toBe(true);
  });
});
