#!/usr/bin/env tsx
/**
 * Validate every relative link in every `.md` file.
 *
 * Ported from the website repository's scripts/check-docs-links.ts rather
 * than rewritten. A hand-rolled version attempted while drafting the harness
 * spec reported clean while missing a genuinely broken link, which is the
 * argument for reusing something already exercised.
 *
 * Walks every `.md` file (excluding build / cache / vendor dirs),
 * extracts both Markdown `[text](target)` links and JSX-style `<a href="...">`
 * links from MDX, and verifies:
 *   - the target path resolves to an existing file or directory
 *   - if the link has an `#anchor`, that the anchor exists in the target
 *     (GitHub heading-slug rules, plus explicit `<a id="…">`/`name` anchors)
 *
 * External links (http(s)://, mailto:, tel:, ftp:, bare #frag) are skipped.
 * Site-absolute routes (starting with `/`) are skipped — those are validated
 * by the Astro build's `astro check`.
 *
 * Usage: `pnpm check:docs` — exit 0 = clean, exit 1 = broken links printed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.wrangler', '.claude']);

interface Link {
  file: string; // repo-relative path
  line: number;
  text: string;
  target: string;
}

interface Broken {
  link: Link;
  reason: string;
}

function walkMarkdown(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (IGNORED_DIRS.has(rel)) continue;
    if (entry.isDirectory()) {
      walkMarkdown(full, root, out);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.md') || lower.endsWith('.mdx')) out.push(full);
    }
  }
  return out;
}

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

function extractLinks(absPath: string, root: string, content: string): Link[] {
  const links: Link[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK_RE.exec(line)) !== null) {
      links.push({
        file: path.relative(root, absPath),
        line: i + 1,
        text: m[1] ?? '',
        target: m[2] ?? '',
      });
    }
    HREF_RE.lastIndex = 0;
    while ((m = HREF_RE.exec(line)) !== null) {
      links.push({
        file: path.relative(root, absPath),
        line: i + 1,
        text: '<a>',
        target: m[1] ?? m[2] ?? '',
      });
    }
  }
  return links;
}

function isOutOfScope(target: string): boolean {
  // External protocols, bare anchors, and site-absolute routes are not
  // resolved by this script — the build handles route validation.
  return /^(https?:|mailto:|tel:|ftp:|#|\/)/.test(target);
}

/** GitHub-flavored heading slug, close enough for anchor checks. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1') // strip inline code
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // strip markdown link syntax, keep text
    .replace(/[*_~]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ANCHOR_ID_RE = /<a\b[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

/**
 * Collect every anchor a `#fragment` link can target in a doc: GitHub-style
 * heading slugs plus explicit `<a id="…">` / `<a name="…">` anchors (used by the
 * glossary so each term is deep-linkable without a heading per term).
 */
function extractAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m?.[1] !== undefined) anchors.add(slugify(m[1]));
    ANCHOR_ID_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ANCHOR_ID_RE.exec(line)) !== null) {
      anchors.add(a[1] ?? a[2] ?? '');
    }
  }
  return anchors;
}

function resolveTarget(
  sourceAbs: string,
  pathPart: string,
): { abs: string; isDir: boolean } | null {
  const base = path.dirname(sourceAbs);
  const decoded = decodeURIComponent(pathPart);
  const abs = path.resolve(base, decoded);
  if (!existsSync(abs)) return null;
  return { abs, isDir: statSync(abs).isDirectory() };
}

function pickAnchorHost(target: { abs: string; isDir: boolean }): string | null {
  if (!target.isDir) return target.abs;
  const indexCandidates = ['README.md', 'readme.md', 'index.md'];
  for (const name of indexCandidates) {
    const candidate = path.join(target.abs, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main(): number {
  const root = process.cwd();
  // `--files <abs|rel> [<abs|rel> ...]` lets the pre-commit hook hand us the
  // staged docs and skip the full repo walk. Cross-file anchor checks still
  // work because `anchorsCache` reads target files lazily on demand.
  const filesIdx = process.argv.indexOf('--files');
  const explicit =
    filesIdx !== -1
      ? process.argv
          .slice(filesIdx + 1)
          .filter((a) => !a.startsWith('--'))
          .map((p) => path.resolve(p))
          .filter((p) => /\.(md|mdx)$/i.test(p) && existsSync(p))
      : null;
  const files = explicit && explicit.length > 0 ? explicit : walkMarkdown(root, root);
  const anchorsCache = new Map<string, Set<string>>();
  const broken: Broken[] = [];
  let checked = 0;

  for (const abs of files) {
    const content = readFileSync(abs, 'utf8');
    // Pre-populate the cache with this file's own anchors so a self-anchor
    // link like `[see below](#section)` doesn't trigger a redundant re-read.
    if (!anchorsCache.has(abs)) {
      anchorsCache.set(abs, extractAnchors(content));
    }
    const links = extractLinks(abs, root, content);
    for (const link of links) {
      if (isOutOfScope(link.target)) continue;
      checked++;

      const [rawPath = '', anchor] = link.target.split('#');
      const pathPart = rawPath.trim();

      const resolved = resolveTarget(abs, pathPart);
      if (!resolved) {
        broken.push({ link, reason: `path does not exist: ${pathPart}` });
        continue;
      }

      if (!anchor) continue;

      const host = pickAnchorHost(resolved);
      if (!host) {
        broken.push({
          link,
          reason: `link to directory has #anchor but no README.md/index.md to host it`,
        });
        continue;
      }

      let anchors = anchorsCache.get(host);
      if (!anchors) {
        anchors = extractAnchors(readFileSync(host, 'utf8'));
        anchorsCache.set(host, anchors);
      }
      if (!anchors.has(anchor)) {
        broken.push({
          link,
          reason: `anchor "#${anchor}" not found in ${path.relative(root, host)}`,
        });
      }
    }
  }

  if (broken.length === 0) {
    console.log(
      `\u2713 ${checked} markdown link${checked === 1 ? '' : 's'} OK across ${files.length} file${files.length === 1 ? '' : 's'}.`,
    );
    return 0;
  }
  console.error(
    `\u2717 ${broken.length} broken link${broken.length === 1 ? '' : 's'} (of ${checked} checked):\n`,
  );
  for (const b of broken) {
    console.error(`  ${b.link.file}:${b.link.line}  [${b.link.text}](${b.link.target})`);
    console.error(`    \u2192 ${b.reason}`);
  }
  return 1;
}

process.exit(main());
