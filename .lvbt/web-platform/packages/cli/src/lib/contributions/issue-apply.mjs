import { successful } from './trusted-report.mjs';
const normalize = (value) =>
  typeof value === 'string' ? value.replaceAll('\r\n', '\n').trimEnd() : undefined;
export const sameLabel = (left, right) =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.toLowerCase() === right.toLowerCase();
export const hasLabels = (labels, names) =>
  Array.isArray(labels) &&
  names.every((name) => labels.some((label) => sameLabel(label?.name, name)));
async function pinIssue(action, repository, gh) {
  const [owner, name] = repository.split('/');
  const query =
    'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id isPinned}}}';
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${action.number}`,
  ];
  const issue = (await gh(args)).data?.repository?.issue;
  if (typeof issue?.id !== 'string' || typeof issue.isPinned !== 'boolean')
    throw new Error('Could not verify contribution issue pin state.');
  if (!issue.isPinned) {
    await gh([
      'api',
      'graphql',
      '-f',
      'query=mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{id}}}',
      '-f',
      `id=${issue.id}`,
    ]);
    if ((await gh(args)).data?.repository?.issue?.isPinned !== true)
      throw new Error('GitHub did not store the requested contribution issue pin.');
  }
}
async function ensureLabels(actions, repository, context) {
  const labels = await context.gh([
    'label',
    'list',
    '--repo',
    repository,
    '--limit',
    '1000',
    '--json',
    'name',
  ]);
  if (
    !Array.isArray(labels) ||
    labels.length >= 1000 ||
    labels.some((label) => typeof label?.name !== 'string' || !label.name)
  )
    throw new Error('Contribution label inventory is invalid or truncated.');
  for (const name of new Map(
    actions.flatMap((action) => action.labels).map((name) => [name.toLowerCase(), name]),
  ).values())
    if (!labels.some((label) => sameLabel(label.name, name)))
      await successful(
        context.run,
        'gh',
        [
          'label',
          'create',
          name,
          '--repo',
          repository,
          '--color',
          'B60205',
          '--description',
          'Maintained by verified LVBT contribution automation.',
        ],
        { cwd: context.cwd, message: 'Contribution label creation failed.' },
      );
}
async function storedIssue(action, repository, gh) {
  const stored = await gh([
    'issue',
    'view',
    String(action.number),
    '--repo',
    repository,
    '--json',
    'number,title,body,state,labels,url',
  ]);
  if (
    stored.title !== action.title ||
    normalize(stored.body) !== normalize(action.body) ||
    stored.state !== (action.action === 'close' ? 'CLOSED' : 'OPEN') ||
    !hasLabels(stored.labels, action.labels)
  )
    throw new Error(
      'GitHub stored contribution issue metadata differently from the verified preview.',
    );
  action.url = stored.url;
}
export async function applyIssueActions(actions, repository, context) {
  const { run, gh, cwd } = context;
  await ensureLabels(actions, repository, context);
  for (const action of actions) {
    const file = context.bodyFile(action);
    if (action.action === 'create') {
      const created = JSON.parse(
        await successful(run, process.execPath, context.helperArguments(action, repository, file), {
          cwd,
          message: 'Contribution creation failed.',
        }),
      );
      action.number = created.number;
    } else {
      await successful(
        run,
        'gh',
        [
          'issue',
          'edit',
          String(action.number),
          '--repo',
          repository,
          '--title',
          action.title,
          '--body-file',
          file,
          ...action.labels.flatMap((name) => ['--add-label', name]),
        ],
        { cwd, message: 'Contribution issue update failed.' },
      );
      if (['close', 'reopen'].includes(action.action))
        await successful(
          run,
          'gh',
          ['issue', action.action, String(action.number), '--repo', repository],
          { cwd, message: 'Contribution issue state update failed.' },
        );
    }
    await storedIssue(action, repository, gh);
    if (action.pin) await pinIssue(action, repository, gh);
  }
}
