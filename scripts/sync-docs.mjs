// Copies the jargo documentation into the Starlight content tree.
//
// The prose lives in the jargo repository (docs/), next to the code it
// describes, and is written to read well on GitHub: Hugo-style front matter
// (title, weight), an H1 under the front matter, and plain relative links to
// other .md files. This script adapts each page for Starlight without touching
// the source:
//
//   _index.md                 → index.md (sidebar: "Overview", first in its group)
//   weight: N                 → sidebar.order: N
//   front-matter title        → sidebar.label (short, for the sidebar)
//   leading "# Heading"       → title (the page H1; Starlight renders it itself)
//   description              → description; without one, the first prose
//                                paragraph, cut to ≤ 160 chars
//   [x](frames.md#anchor)     → [x](/docs/concepts/frames/#anchor)
//   [x](../../examples/echo)  → [x](https://github.com/gojargo/jargo/tree/main/examples/echo)
//
// Source: $JARGO_DOCS, else ../jargo/docs (sibling checkout), else ./jargo/docs (CI).
// Output: src/content/docs/docs/ (generated, git-ignored, wiped on every run).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/gojargo/jargo';
const ROUTE = '/docs/';

const candidates = [process.env.JARGO_DOCS, resolve(root, '../jargo/docs'), resolve(root, 'jargo/docs')].filter(Boolean);
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.error(`sync-docs: jargo docs not found. Tried:\n  ${candidates.join('\n  ')}\nSet JARGO_DOCS or check out gojargo/jargo next to this repo.`);
  process.exit(1);
}
const out = resolve(root, 'src/content/docs/docs');

let warnings = 0;
const warn = (msg) => {
  warnings++;
  console.warn(`sync-docs: ${msg}`);
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

const files = walk(src).map((abs) => posix.normalize(relative(src, abs).split('\\').join('/')));
const known = new Set(files);

/** docs-relative source path ("concepts/_index.md") → site route ("/docs/concepts/"). */
function route(file) {
  const noExt = file.replace(/\.md$/, '');
  const slug = noExt === '_index' ? '' : noExt.replace(/\/_index$/, '');
  return ROUTE + (slug ? `${slug}/` : '');
}

/** Rewrite one link target found in `file`; returns it unchanged when not ours. */
function rewrite(target, file) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target; // absolute, anchor, scheme
  const [path, hash = ''] = target.split(/(?=#)/);
  const resolved = posix.normalize(posix.join(posix.dirname(file), path));
  if (resolved.startsWith('../')) {
    // Escapes docs/: a repository file or directory.
    const repoPath = resolved.replace(/^\.\.\//, '');
    if (repoPath.startsWith('../')) {
      warn(`${file}: link "${target}" escapes the repository`);
      return target;
    }
    return `${REPO}/tree/main/${repoPath}${hash}`;
  }
  if (path.endsWith('.md')) {
    if (!known.has(resolved)) warn(`${file}: unresolved link "${target}"`);
    return route(resolved) + hash;
  }
  return target;
}

/** Rewrite inline links outside fenced code blocks and inline code spans. */
function rewriteLinks(body, file) {
  let fence = null;
  return body
    .split('\n')
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) {
        if (!fence) fence = m[1];
        else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return line;
      }
      if (fence) return line;
      // Split on inline code so `[a](b)` inside backticks is left alone.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 ? part : part.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, t, title) => `](${rewrite(t, file)}${title})`)))
        .join('');
    })
    .join('\n');
}

const yamlString = (s) => JSON.stringify(s); // JSON strings are valid YAML scalars

/** Markdown → plain text, for the meta description. */
const plain = (md) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The first prose paragraph (no heading, code, table, list, quote or HTML),
 * cut to whole sentences within 160 characters, or to whole words if the
 * first sentence alone is longer.
 */
function describe(body) {
  // Drop fenced code first: a fence can contain blank lines.
  const prose = body.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, '');
  for (const block of prose.split(/\n\s*\n/)) {
    const first = block.trimStart();
    // Skip headings, tables, quotes, HTML, images and list items (not **bold**).
    if (!first || /^([#|><!]|[-*+]\s|\d+\.\s|\[!)/.test(first)) continue;
    // A paragraph that introduces a list or a table still describes the page.
    const text = plain(block).replace(/:$/, '.');
    if (text.length < 60) continue;
    if (text.length <= 160) return text;
    let out = '';
    for (const sentence of text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []) {
      if ((out + sentence).trim().length > 160) break;
      out += sentence;
    }
    if (out.trim().length >= 80) return out.trim();
    return text.slice(0, 157).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '...';
  }
  return null;
}

rmSync(out, { recursive: true, force: true });
for (const file of files) {
  const raw = readFileSync(join(src, file), 'utf8').replace(/\r\n/g, '\n');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  } else {
    warn(`${file}: no front matter`);
  }
  let body = fm ? raw.slice(fm[0].length) : raw;

  // The first H1 becomes the page title; Starlight renders it as the heading.
  let title = meta.title;
  const h1 = body.match(/^\s*# (.+)\n/);
  if (h1) {
    title = h1[1].trim();
    body = body.slice(h1[0].length);
  }
  if (!title) {
    warn(`${file}: no title`);
    title = file;
  }

  // A section's _index.md leads its sidebar group as "Overview".
  const isSectionIndex = /\/_index\.md$/.test(file);
  const lines = ['---', `title: ${yamlString(title)}`];
  const description = meta.description || describe(body);
  if (description) lines.push(`description: ${yamlString(description)}`);
  else warn(`${file}: no paragraph for a description`);
  const label = isSectionIndex ? 'Overview' : meta.title && meta.title !== title ? meta.title : null;
  const order = isSectionIndex ? 0 : meta.weight && !Number.isNaN(Number(meta.weight)) ? Number(meta.weight) : null;
  if (label || order !== null) {
    lines.push('sidebar:');
    if (label) lines.push(`  label: ${yamlString(label)}`);
    if (order !== null) lines.push(`  order: ${order}`);
  }
  lines.push(`editUrl: ${yamlString(`${REPO}/edit/main/docs/${file}`)}`, '---', '');

  const dest = join(out, file.replace(/(^|\/)_index\.md$/, '$1index.md'));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, lines.join('\n') + rewriteLinks(body, file));
}

console.log(`sync-docs: ${files.length} pages from ${relative(root, src) || src}${warnings ? `, ${warnings} warning(s)` : ''}`);
