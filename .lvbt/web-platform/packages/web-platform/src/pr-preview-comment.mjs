export function prPreviewComment(app, url) {
  if (app && !/^[a-z0-9][a-z0-9-]*$/u.test(app))
    throw new Error('PR comment requires a reviewed release profile.');
  const marker = app ? `<!-- lvbt-worker-preview:${app} -->` : '<!-- lvbt-worker-preview -->';
  const label = app ? `Worker candidate (${app})` : 'Worker candidate';
  return {
    marker,
    body: `${marker}\n${label}: ${url}\n\nPR preview only; production uses a separately retained staging release.`,
  };
}
