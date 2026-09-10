import AxeBuilder from '@axe-core/playwright';

function describeViolation(violation) {
  const nodes = violation.nodes
    .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary ?? node.html}`)
    .join('\n');
  return `${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}\n${nodes}`;
}

/** Analyze the current page against the organization WCAG A/AA baseline. */
export async function expectNoAccessibilityViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  if (results.violations.length === 0) return;
  throw new Error(
    `Accessibility violations:\n\n${results.violations.map(describeViolation).join('\n\n')}`,
  );
}
