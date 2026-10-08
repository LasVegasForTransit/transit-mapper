import path from 'node:path';
import { applyIssueActions } from './issue-apply.mjs';
import { helperArguments } from './recurring.mjs';

export async function applyRecurring(actions, repository, directory, context) {
  return await applyIssueActions(actions, repository, {
    ...context,
    bodyFile: (action) => path.join(directory, `${action.key}.md`),
    helperArguments,
  });
}
