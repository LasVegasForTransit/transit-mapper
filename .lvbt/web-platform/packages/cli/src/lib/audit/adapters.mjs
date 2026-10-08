const fail = (message) => {
  throw new Error(message);
};
const finding = (title, diagnostic, location, url) => ({
  title,
  diagnostic,
  ...(location ? { location } : {}),
  ...(url ? { url } : {}),
});

function structuredLinks(data) {
  if (!Array.isArray(data.results) || (!data.results.length && !(data.checked > 0)))
    fail('Link output has no checked URLs or results.');
  if (
    data.results.some(
      (entry) => typeof entry.url !== 'string' || !['pass', 'fail', 'error'].includes(entry.status),
    )
  )
    fail('Link results are malformed.');
  return {
    status: data.results.some((entry) => entry.status === 'error')
      ? 'error'
      : data.results.some((entry) => entry.status === 'fail')
        ? 'fail'
        : 'pass',
    findings: data.results
      .filter((entry) => entry.status !== 'pass')
      .map((entry) =>
        finding(
          `Broken link: ${entry.url}`,
          entry.diagnostic ?? 'Link validation failed.',
          entry.source,
          entry.url,
        ),
      ),
  };
}

function lychee(data) {
  if (!Number.isFinite(data.total) || data.total <= 0 || !Number.isFinite(data.errors))
    fail('Lychee output has no valid audit evidence.');
  const findings = Object.entries(data.error_map ?? {}).flatMap(([source, entries]) =>
    entries.map((entry) =>
      finding(
        `Broken link: ${entry.url}`,
        `${entry.status?.code ?? 'error'} ${entry.status?.text ?? 'Link validation failed.'}`,
        source,
        entry.url,
      ),
    ),
  );
  if (data.errors > 0 && !findings.length)
    findings.push(
      finding('Link check failed', `${data.errors} links failed; see the raw audit artifact.`),
    );
  return { status: data.errors > 0 ? 'fail' : 'pass', findings };
}

function lhci(data) {
  const assertions = Array.isArray(data) ? data : data.assertions;
  if (
    !Array.isArray(assertions) ||
    !assertions.length ||
    assertions.some((entry) => typeof entry.passed !== 'boolean')
  )
    fail('LHCI output has no valid assertion results.');
  const failures = assertions.filter((entry) => !entry.passed && entry.level !== 'warn');
  return {
    status: failures.length ? 'fail' : 'pass',
    findings: failures.map((entry) =>
      finding(
        `Lighthouse: ${entry.auditId ?? entry.name ?? 'assertion'}`,
        `Actual ${entry.actual}; expected ${entry.operator ?? '>='} ${entry.expected}.`,
        entry.url,
      ),
    ),
  };
}

function lighthouse(data) {
  if (
    !data.categories ||
    !Object.values(data.categories).some((category) => Number.isFinite(category.score))
  )
    fail('Lighthouse report has no valid category scores.');
  if (data.runtimeError)
    return {
      status: 'error',
      findings: [
        finding(
          'Lighthouse could not complete',
          data.runtimeError.message ?? data.runtimeError.code,
        ),
      ],
    };
  const failed = Object.entries(data.categories).filter(
    ([, category]) => Number.isFinite(category.score) && category.score < 0.9,
  );
  const findings = failed.map(([name, category]) =>
    finding(
      `Lighthouse ${name} score below 90`,
      `${Math.round(category.score * 100)}/100; expected at least 90/100.`,
      data.finalUrl,
    ),
  );
  if (failed.length)
    for (const [id, entry] of Object.entries(data.audits ?? {})) {
      if (Number.isFinite(entry.score) && entry.score < 0.9)
        findings.push(
          finding(
            entry.title ?? id,
            entry.displayValue ?? entry.description ?? `Score ${entry.score}.`,
            data.finalUrl,
          ),
        );
    }
  return { status: failed.length ? 'fail' : 'pass', findings };
}

function modernDependencies(data) {
  const findings = [];
  for (const [name, entry] of Object.entries(data.vulnerabilities ?? {})) {
    for (const advisory of entry.via ?? []) {
      if (typeof advisory === 'string') continue;
      findings.push(
        finding(
          `${advisory.severity ?? entry.severity}: ${name} — ${advisory.title}`,
          `Affected ${advisory.range ?? entry.range}; ${entry.fixAvailable ? 'a fix is available.' : 'review dependency remediation.'}`,
          entry.nodes?.join(', '),
          advisory.url,
        ),
      );
    }
  }
  return findings;
}

function dependencies(data) {
  const counts = data.metadata?.vulnerabilities;
  if (
    !counts ||
    !Object.values(counts).length ||
    Object.values(counts).some((count) => !Number.isFinite(count) || count < 0)
  )
    fail('pnpm audit output has no valid vulnerability evidence.');
  const findings = Object.values(data.advisories ?? {}).map((entry) =>
    finding(
      `${entry.severity}: ${entry.module_name} — ${entry.title}`,
      `${entry.vulnerable_versions ?? ''}. ${entry.recommendation ?? 'Update to a patched version.'}`,
      entry.findings?.flatMap((match) => match.paths ?? []).join(', '),
      entry.url,
    ),
  );
  findings.push(...modernDependencies(data));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total && !findings.length)
    findings.push(
      finding(
        'Dependency vulnerabilities detected',
        `${total} vulnerabilities reported; inspect the raw pnpm audit artifact for dependency paths and remediation.`,
      ),
    );
  return { status: total ? 'fail' : 'pass', findings };
}

export function parseAudit(check, format, data, exitCode = 0) {
  if (!data || typeof data !== 'object') fail('Audit output must contain JSON evidence.');
  const adapters = {
    links: { links: structuredLinks, lychee },
    lighthouse: { lighthouse, lhci },
    dependencies: { pnpm: dependencies },
  };
  const adapter = adapters[check]?.[format];
  if (!adapter) fail(`Unsupported audit adapter: ${check}/${format}.`);
  const result = adapter(data);
  if (exitCode !== 0 && result.status === 'pass')
    return {
      status: 'error',
      findings: [
        finding(
          'Audit tool failed',
          `Tool exited with status ${exitCode} despite reporting no findings.`,
        ),
      ],
    };
  return result;
}
