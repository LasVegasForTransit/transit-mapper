import { describe, expect, it } from 'vitest';

import { planIssueReconciliation } from '../src/issue-reconciliation.js';
import type { ValidationResult } from '../src/validation.js';

const invalid: ValidationResult = {
  valid: false,
  errors: [
    {
      code: 'section_too_short',
      field: 'reproduction',
      message: 'The reproduction section must contain at least 20 non-whitespace characters.',
    },
  ],
};

describe('issue metadata reconciliation', () => {
  it('labels an invalid issue and creates one correction comment', () => {
    const operations = planIssueReconciliation({
      validation: invalid,
      labels: [],
      comments: [],
    });

    expect(operations).toEqual([
      { type: 'add-label', label: 'needs-information' },
      {
        type: 'create-comment',
        body: '<!-- transitmapper:metadata-check -->\nThis issue needs the following correction:\n\n- The reproduction section must contain at least 20 non-whitespace characters.',
      },
    ]);
  });

  it('does nothing when the same invalid result is reconciled again', () => {
    const body = planIssueReconciliation({ validation: invalid, labels: [], comments: [] }).find(
      (operation): operation is Extract<typeof operation, { type: 'create-comment' }> =>
        operation.type === 'create-comment',
    );
    if (!body) throw new Error('expected a comment operation');

    expect(
      planIssueReconciliation({
        validation: invalid,
        labels: ['needs-information'],
        comments: [{ id: 91, author: 'github-actions[bot]', body: body.body }],
      }),
    ).toEqual([]);
  });

  it('updates the managed comment when an edit needs different corrections', () => {
    const operations = planIssueReconciliation({
      validation: invalid,
      labels: ['needs-information'],
      comments: [
        {
          id: 91,
          author: 'github-actions[bot]',
          body: '<!-- transitmapper:metadata-check -->\nOld corrections.',
        },
      ],
    });

    expect(operations).toEqual([
      {
        type: 'update-comment',
        commentId: 91,
        body: '<!-- transitmapper:metadata-check -->\nThis issue needs the following correction:\n\n- The reproduction section must contain at least 20 non-whitespace characters.',
      },
    ]);
  });

  it('removes the label and validator comment after the issue is corrected', () => {
    const operations = planIssueReconciliation({
      validation: { valid: true, errors: [] },
      labels: ['bug', 'needs-information'],
      comments: [
        {
          id: 91,
          author: 'github-actions[bot]',
          body: '<!-- transitmapper:metadata-check -->\nOld corrections.',
        },
        { id: 92, author: 'maintainer', body: 'Please also include a browser version.' },
      ],
    });

    expect(operations).toEqual([
      { type: 'remove-label', label: 'needs-information' },
      { type: 'delete-comment', commentId: 91 },
    ]);
  });
});
