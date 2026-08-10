export type IssueTemplate = 'bug' | 'idea';
export type MetadataKind = 'issue' | 'pull-request';

interface SectionDefinition {
  name: string;
  prompt: string;
  required: boolean;
}

interface BodyDefinition {
  identityMarker: string;
  sections: readonly SectionDefinition[];
}

export interface IssueBodyInput {
  template: IssueTemplate;
  sections: Record<string, string>;
}

export interface PullRequestBodyInput {
  sections: Record<string, string>;
}

export interface MetadataInput {
  kind: MetadataKind;
  title: string;
  body: string;
  actor?: string;
  headBranch?: string;
  draft?: boolean;
}

export interface ValidationError {
  code: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const BUG_DEFINITION: BodyDefinition = {
  identityMarker: '<!-- transitmapper:issue:bug -->',
  sections: [
    {
      name: 'reproduction',
      prompt: 'Describe the shortest sequence that reproduces the problem.',
      required: true,
    },
    {
      name: 'expected',
      prompt: 'Describe what you expected to happen.',
      required: true,
    },
    {
      name: 'actual',
      prompt: 'Describe what happened instead.',
      required: true,
    },
    {
      name: 'evidence',
      prompt: 'Optional: add screenshots, recordings, logs, or relevant context.',
      required: false,
    },
  ],
};

const IDEA_DEFINITION: BodyDefinition = {
  identityMarker: '<!-- transitmapper:issue:idea -->',
  sections: [
    {
      name: 'goal',
      prompt: 'Describe the outcome you want to make possible.',
      required: true,
    },
    {
      name: 'current-blocker',
      prompt: 'Describe what prevents that outcome today.',
      required: true,
    },
    {
      name: 'examples',
      prompt: 'Optional: add examples that clarify the idea.',
      required: false,
    },
  ],
};

const PULL_REQUEST_DEFINITION: BodyDefinition = {
  identityMarker: '<!-- transitmapper:pull-request -->',
  sections: [
    {
      name: 'summary',
      prompt: 'Summarize what changes for a user or maintainer.',
      required: true,
    },
    {
      name: 'reason',
      prompt: 'Explain why this change is needed and the important trade-offs.',
      required: true,
    },
    {
      name: 'verification',
      prompt: 'Describe the checks and manual behavior you verified.',
      required: true,
    },
    {
      name: 'followups',
      prompt: 'Optional: name work deliberately left for another change.',
      required: false,
    },
  ],
};

export const CONTRIBUTION_METADATA_STATUS = 'Contribution metadata';
export const ISSUE_VALIDATION_COMMENT_MARKER = '<!-- transitmapper:metadata-check -->';
export const ISSUE_INFORMATION_LABEL = 'needs-information';
export const ISSUE_INFORMATION_LABEL_COLOR = 'D4C5F9';
export const ISSUE_INFORMATION_LABEL_DESCRIPTION =
  'More information is needed before this issue can be acted on.';

export const BODY_DEFINITIONS = {
  bug: BUG_DEFINITION,
  idea: IDEA_DEFINITION,
  'pull-request': PULL_REQUEST_DEFINITION,
} as const;

const PLACEHOLDER_TITLES = new Set([
  'bug report',
  'feature request',
  'idea',
  'pull request',
  'fix: pull request',
  'todo',
  'untitled',
  'update',
]);

const CONVENTIONAL_TITLE = /^[a-z]+(?:\([a-z0-9._/-]+\))?!?: .+/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CONTRACT_MARKER = /<!--\s*transitmapper:[\s\S]*?-->/g;

function startMarker(name: string): string {
  return `<!-- transitmapper:${name}:start -->`;
}

function endMarker(name: string): string {
  return `<!-- transitmapper:${name}:end -->`;
}

function renderBody(definition: BodyDefinition, sections: Record<string, string>): string {
  const blocks = definition.sections.map((section) => {
    const value = sections[section.name] ?? '';
    return [
      startMarker(section.name),
      `<!-- ${section.prompt} -->`,
      value,
      endMarker(section.name),
    ].join('\n');
  });
  return `${definition.identityMarker}\n\n${blocks.join('\n\n')}\n`;
}

export function renderIssueBody(input: IssueBodyInput): string {
  return renderBody(BODY_DEFINITIONS[input.template], input.sections);
}

export function renderPullRequestBody(input: PullRequestBodyInput): string {
  return renderBody(PULL_REQUEST_DEFINITION, input.sections);
}

function error(code: string, field: string, message: string): ValidationError {
  return { code, field, message };
}

function validateTitle(kind: MetadataKind, title: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (title !== title.trim()) {
    errors.push(
      error('title_not_trimmed', 'title', 'The title must not begin or end with whitespace.'),
    );
  }

  // The commit hook measures bytes with wc -c. Reuse that exact PR boundary
  // so an accepted title can become the squash commit subject. Issue titles
  // follow GitHub's reader-facing character contract instead.
  const length = kind === 'issue' ? Array.from(title).length : Buffer.byteLength(title);
  const normalized = title.trim().toLowerCase();
  if (PLACEHOLDER_TITLES.has(normalized)) {
    errors.push(
      error('placeholder_title', 'title', 'Replace the placeholder with a specific title.'),
    );
  }

  if (kind === 'issue') {
    if (length < 10) {
      errors.push(
        error('title_too_short', 'title', 'The issue title must be at least 10 characters.'),
      );
    }
    if (length > 120) {
      errors.push(
        error('title_too_long', 'title', 'The issue title must be no more than 120 characters.'),
      );
    }
  } else {
    if (length > 72) {
      errors.push(
        error(
          'title_too_long',
          'title',
          'The pull request title must be no more than 72 characters.',
        ),
      );
    }
    if (!CONVENTIONAL_TITLE.test(title)) {
      errors.push(
        error(
          'invalid_title_format',
          'title',
          'Use a conventional title such as "fix(ui): restore menu activation".',
        ),
      );
    }
  }
  return errors;
}

function occurrences(body: string, marker: string): number[] {
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const position = body.indexOf(marker, from);
    if (position === -1) return positions;
    positions.push(position);
    from = position + marker.length;
  }
}

function expectedMarkers(definition: BodyDefinition): string[] {
  return [
    definition.identityMarker,
    ...definition.sections.flatMap((section) => [
      startMarker(section.name),
      endMarker(section.name),
    ]),
  ];
}

function identifyIssueDefinition(
  body: string,
  errors: ValidationError[],
): BodyDefinition | undefined {
  const bugCount = occurrences(body, BUG_DEFINITION.identityMarker).length;
  const ideaCount = occurrences(body, IDEA_DEFINITION.identityMarker).length;
  if (bugCount + ideaCount === 0) {
    errors.push(
      error('missing_marker', 'body', 'The issue body is missing its bug or idea template marker.'),
    );
    return undefined;
  }
  if (bugCount + ideaCount !== 1) {
    errors.push(
      error('duplicate_marker', 'body', 'The issue body must contain exactly one template marker.'),
    );
    return undefined;
  }
  return bugCount === 1 ? BUG_DEFINITION : IDEA_DEFINITION;
}

function markerField(definition: BodyDefinition, marker: string): string {
  return (
    definition.sections.find(
      (section) => marker === startMarker(section.name) || marker === endMarker(section.name),
    )?.name ?? 'body'
  );
}

function malformedMarkerErrors(expected: string[], body: string): ValidationError[] {
  const known = new Set(expected);
  return (body.match(CONTRACT_MARKER) ?? [])
    .filter((marker) => !known.has(marker))
    .map((marker) =>
      error('malformed_marker', 'body', `Remove or correct the malformed marker: ${marker}`),
    );
}

function markersAreOrdered(positions: number[]): boolean {
  let previous: number | undefined;
  for (const position of positions) {
    if (previous !== undefined && position <= previous) return false;
    previous = position;
  }
  return true;
}

function validateMarkerStructure(definition: BodyDefinition, body: string): ValidationError[] {
  const expected = expectedMarkers(definition);
  const errors = malformedMarkerErrors(expected, body);

  const positions: number[] = [];
  for (const marker of expected) {
    const found = occurrences(body, marker);
    const field = markerField(definition, marker);
    if (found.length === 0) {
      errors.push(error('missing_marker', field, `The ${field} marker is missing.`));
    } else if (found.length > 1) {
      errors.push(error('duplicate_marker', field, `The ${field} marker appears more than once.`));
    } else {
      positions.push(found[0] ?? -1);
    }
  }

  if (positions.length === expected.length && !markersAreOrdered(positions)) {
    errors.push(
      error(
        'marker_order',
        'body',
        'Keep every section marker in the template order without nesting.',
      ),
    );
  }

  return errors;
}

function validateRequiredSections(definition: BodyDefinition, body: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const section of definition.sections) {
    if (!section.required) continue;
    const starts = occurrences(body, startMarker(section.name));
    const ends = occurrences(body, endMarker(section.name));
    const start = starts.at(0);
    const end = ends.at(0);
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      start === undefined ||
      end === undefined ||
      start >= end
    ) {
      continue;
    }
    const content = body.slice(start + startMarker(section.name).length, end);
    const nonWhitespaceLength = content.replace(HTML_COMMENT, '').replace(/\s/g, '').length;
    if (nonWhitespaceLength < 20) {
      errors.push(
        error(
          'section_too_short',
          section.name,
          `The ${section.name} section must contain at least 20 non-whitespace characters.`,
        ),
      );
    }
  }

  return errors;
}

function validateBody(definition: BodyDefinition, body: string): ValidationError[] {
  return [
    ...validateMarkerStructure(definition, body),
    ...validateRequiredSections(definition, body),
  ];
}

function isAutomationExempt(input: MetadataInput): boolean {
  const actor = input.actor ?? '';
  const branch = input.headBranch ?? '';
  return (
    (actor === 'github-actions[bot]' &&
      branch.startsWith('release-please--branches--main--components--')) ||
    (actor === 'dependabot[bot]' && branch.startsWith('dependabot/')) ||
    (actor === 'renovate[bot]' && branch.startsWith('renovate/'))
  );
}

export function validateMetadata(input: MetadataInput): ValidationResult {
  const errors = validateTitle(input.kind, input.title);
  if (input.kind === 'pull-request' && (input.draft === true || isAutomationExempt(input))) {
    return { valid: errors.length === 0, errors };
  }

  let definition: BodyDefinition | undefined;
  if (input.kind === 'issue') {
    definition = identifyIssueDefinition(input.body, errors);
  } else {
    definition = PULL_REQUEST_DEFINITION;
  }

  if (definition) errors.push(...validateBody(definition, input.body));
  return { valid: errors.length === 0, errors };
}
