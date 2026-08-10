import {
  ISSUE_INFORMATION_LABEL,
  ISSUE_VALIDATION_COMMENT_MARKER,
  type ValidationResult,
} from './validation.js';

export interface IssueComment {
  id: number;
  author: string;
  body: string;
}

export interface IssueReconciliationInput {
  validation: ValidationResult;
  labels: string[];
  comments: IssueComment[];
}

export type IssueOperation =
  | { type: 'add-label'; label: string }
  | { type: 'remove-label'; label: string }
  | { type: 'create-comment'; body: string }
  | { type: 'update-comment'; commentId: number; body: string }
  | { type: 'delete-comment'; commentId: number };

function correctionComment(validation: ValidationResult): string {
  const noun = validation.errors.length === 1 ? 'correction' : 'corrections';
  const corrections = validation.errors.map((item) => `- ${item.message}`).join('\n');
  return `${ISSUE_VALIDATION_COMMENT_MARKER}\nThis issue needs the following ${noun}:\n\n${corrections}`;
}

function managedComments(comments: IssueComment[]): IssueComment[] {
  return comments.filter(
    (comment) =>
      comment.author === 'github-actions[bot]' &&
      comment.body.includes(ISSUE_VALIDATION_COMMENT_MARKER),
  );
}

export function planIssueReconciliation(input: IssueReconciliationInput): IssueOperation[] {
  const operations: IssueOperation[] = [];
  const hasLabel = input.labels.includes(ISSUE_INFORMATION_LABEL);
  const managed = managedComments(input.comments);

  if (input.validation.valid) {
    if (hasLabel) operations.push({ type: 'remove-label', label: ISSUE_INFORMATION_LABEL });
    operations.push(
      ...managed.map((comment): IssueOperation => ({
        type: 'delete-comment',
        commentId: comment.id,
      })),
    );
    return operations;
  }

  if (!hasLabel) operations.push({ type: 'add-label', label: ISSUE_INFORMATION_LABEL });
  const body = correctionComment(input.validation);
  const existing = managed.at(0);
  if (managed.length === 0) {
    operations.push({ type: 'create-comment', body });
  } else if (existing && existing.body !== body) {
    operations.push({ type: 'update-comment', commentId: existing.id, body });
  }
  operations.push(
    ...managed.slice(1).map((comment): IssueOperation => ({
      type: 'delete-comment',
      commentId: comment.id,
    })),
  );
  return operations;
}
