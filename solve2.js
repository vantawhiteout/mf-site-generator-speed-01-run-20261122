// A faster, byte-exact drop-in for makefun-site 1.0.0.
// The build rules are makefun-site's own (its README and code in the kit are the reference).
// Everything runs in one module so the hot paths share their caches and avoid module hops.

const RESERVED = ['posts', 'tags', 'page'];
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const NEEDS_ESCAPE = /[&<>"']/;
/** makefun-site's escape table: & < > " ' in that order, nothing else. */
function escapeHtml(s) {
  if (!NEEDS_ESCAPE.test(s)) return s;
  let out = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    let r;
    switch (s[i]) {
      case '&': r = '&amp;'; break;
      case '<': r = '&lt;'; break;
      case '>': r = '&gt;'; break;
      case '"': r = '&quot;'; break;
      case "'": r = '&#39;'; break;
      default: continue;
    }
    out += s.slice(start, i) + r;
    start = i + 1;
  }
  return out + s.slice(start);
}

/** The NFKD/collapse slug rule. ASCII needs no normalisation (NFKD is the identity on it). */
function slugify(text) {
  let plain = text;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (!ascii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '', gap = false;
  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i);
    let keep;
    if (code >= 65 && code <= 90) keep = String.fromCharCode(code + 32);
    else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keep = plain[i];
    else { gap = out.length > 0; continue; }
    if (gap) { out += '-'; gap = false; }
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NUMS = new Int32Array(128);
for (let i = 1; i <= 12; i++) MONTH_NUMS[i] = i;
function longDate(date) {
  const a = date.indexOf('-'), b = date.indexOf('-', a + 1);
  return `${Number(date.slice(b + 1))} ${MONTHS[Number(date.slice(a + 1, b)) - 1]} ${date.slice(0, a)}`;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;
const BLANK_LINE = /^[ \t]*$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function fmValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      const y = m ? Number(m[1]) : 0, mo = m ? Number(m[2]) : 0, d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !FM_TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  if (text.slice(0, 3) !== '---' || (text.length !== 3 && text[3] !== '\n')) return { error: 'no front matter' };
  let p = 4, closeStart = -1, closeEnd = -1;
  while (p <= text.length) {
    const nl = text.indexOf('\n', p);
    const end = nl === -1 ? text.length : nl;
    if (text.slice(p, end) === '---') { closeStart = p; closeEnd = end; break; }
    if (nl === -1) break;
    p = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let lineNo = 1;
  p = 4;
  while (p < closeStart) {
    const nl = text.indexOf('\n', p);
    const end = nl === -1 ? closeStart : nl;
    const line = text.slice(p, end);
    lineNo++;
    if (!isBlank(line) && !line.startsWith('#')) {
      const m = FM_LINE.exec(line);
      if (!m) return { error: `line ${lineNo} is not "key: value"` };
      const key = m[1];
      const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
      if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = fmValue(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    p = end + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- markdown

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const QUOTE = /^>/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;
/** makefun-site trims only spaces and tabs at a line's ends. */
function trimLine(s) {
  let a = 0, b = s.length;
  while (a < b) { const c = s.charCodeAt(a); if (c === 32 || c === 9) a++; else break; }
  while (b > a) { const c = s.charCodeAt(b - 1); if (c === 32 || c === 9) b--; else break; }
  return a === 0 && b === s.length ? s : s.slice(a, b);
}
function onlySpaces(s, from) {
  for (let i = from; i < s.length; i++) { const c = s.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}
function isBlank(s) {
  return onlySpaces(s, 0);
}

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}
function isFenceOpen(line) {
  return line.startsWith('```') && FENCE_OPEN.test(line);
}
function isHr(line) {
  const c = line.charCodeAt(0);
  return (c === 45 || c === 42) && line.startsWith(c === 45 ? '---' : '***') && HR.test(line);
}
function endsParagraph(line) {
  if (isBlank(line)) return true;
  const c = line.charCodeAt(0);
  if (c === 96) return isFenceOpen(line);
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return isHr(line);
  return false;
}
const WS = /\s/;

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const ESC1 = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

/** Inline markdown. Plain runs are escaped in bulk rather than one character at a time. */
const ESC_CODES = new Array(128);
ESC_CODES[38] = '&amp;'; ESC_CODES[60] = '&lt;'; ESC_CODES[62] = '&gt;'; ESC_CODES[34] = '&quot;'; ESC_CODES[39] = '&#39;';

/** Inline markdown in one pass: plain runs are sliced out, escapes are looked up by char code. */
function inline(s, link, stack) {
  const n = s.length;
  let out = '', i = 0, start = 0;
  while (i < n) {
    const code = s.charCodeAt(i);
    if (code < 128 && ESC_CODES[code] !== undefined) {
      if (i > start) out += s.slice(start, i);
      out += ESC_CODES[code];
      i++;
      start = i;
      continue;
    }
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      if (i > start) out += s.slice(start, i);
      out += ESC1[s[i + 1]] ?? s[i + 1];
      i += 2;
      start = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (i > start) out += s.slice(start, i);
        out += '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
        start = i;
        continue;
      }
    } else if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (i > start) out += s.slice(start, i);
          out += '<strong>' + inline(s.slice(i + 2, j), link, stack) + '</strong>';
          i = j + 2;
          start = i;
          continue;
        }
        if (i > start) out += s.slice(start, i);
        out += '**';
        i += 2;
        start = i;
        continue;
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          if (i > start) out += s.slice(start, i);
          out += '<em>' + inline(s.slice(i + 1, j), link, stack) + '</em>';
          i = j + 1;
          start = i;
          continue;
        }
      }
    } else if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS.test(target)) {
        if (i > start) out += s.slice(start, i);
        out += '<a href="' + escapeHtml(link(target)) + '">' + inline(s.slice(i + 1, k), link, stack) + '</a>';
        i = m + 1;
        start = i;
        continue;
      }
    }
    i++;
  }
  if (start < n) out += s.slice(start);
  return out;
}

/** The block lexer and renderer, scanning the source with indices instead of building a lines array. */
function renderMarkdown(src, link, slugCache) {
  const blocks = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  const len = src.length;
  let pos = 0;
  while (pos < len) {
    let nl = src.indexOf('\n', pos);
    let end = nl === -1 ? len : nl;
    const line = src.slice(pos, end);
    const next = nl === -1 ? len : nl + 1;
    const c0 = line.charCodeAt(0);
    if (isBlank(line)) { pos = next; continue; }

    if (c0 === 96 && isFenceOpen(line)) {
      const fence = FENCE_OPEN.exec(line);
      let code = '';
      pos = next;
      while (pos < len) {
        nl = src.indexOf('\n', pos);
        end = nl === -1 ? len : nl;
        const l = src.slice(pos, end);
        pos = nl === -1 ? len : nl + 1;
        if (FENCE_CLOSE.test(l)) break;
        code += escapeHtml(l) + '\n';
      }
      const cls = fence[1] === '' ? '' : ` class="language-${escapeHtml(fence[1])}"`;
      blocks.push(`<pre><code${cls}>${code}</code></pre>`);
      continue;
    }

    if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const text = heading.text;
        let sl = slugCache.get(text);
        if (sl === undefined) { sl = slugify(text); slugCache.set(text, sl); }
        const id = uniqueSlug(sl, ids);
        const html = inline(text, link);
        blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        pos = next;
        continue;
      }
    }

    if ((c0 === 45 || c0 === 42) && HR.test(line)) { blocks.push('<hr>'); pos = next; continue; }

    if (c0 === 62) {
      let body = '';
      while (pos < len) {
        nl = src.indexOf('\n', pos);
        end = nl === -1 ? len : nl;
        const l = src.slice(pos, end);
        if (l.charCodeAt(0) !== 62) break;
        const stripped = l.slice(1);
        const t = trimLine(stripped.charCodeAt(0) === 32 ? stripped.slice(1) : stripped);
        if (t !== '') body += (body === '' ? '' : '\n') + t;
        pos = nl === -1 ? len : nl + 1;
      }
      blocks.push(body === '' ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(body, link)}</p>\n</blockquote>`);
      continue;
    }

    let bulletText = null;
    let ordered = null;
    if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) bulletText = line.slice(2);
    else if (c0 >= 48 && c0 <= 57) ordered = ORDERED.exec(line);
    if (bulletText !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [trimLine(isOrdered ? ordered[2] : bulletText)];
      pos = next;
      while (pos < len) {
        nl = src.indexOf('\n', pos);
        end = nl === -1 ? len : nl;
        const l = src.slice(pos, end);
        let m = null;
        if (isOrdered) m = ORDERED.exec(l);
        else if ((l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) m = BULLET.exec(l);
        if (m !== null) {
          items.push(trimLine(isOrdered ? m[2] : m[1]));
          pos = nl === -1 ? len : nl + 1;
        } else if (l.charCodeAt(0) === 32 && l.charCodeAt(1) === 32 && CONTINUED.test(l)) {
          items[items.length - 1] += '\n' + trimLine(l);
          pos = nl === -1 ? len : nl + 1;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const start = isOrdered ? Number(ordered[1]) : 1;
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      let list = open + '\n';
      for (let k = 0; k < items.length; k++) list += `<li>${inline(items[k], link)}</li>\n`;
      blocks.push(list + `</${tag}>`);
      continue;
    }

    let body = trimLine(line);
    pos = next;
    while (pos < len) {
      nl = src.indexOf('\n', pos);
      end = nl === -1 ? len : nl;
      const l = src.slice(pos, end);
      if (endsParagraph(l)) break;
      body += '\n' + trimLine(l);
      pos = nl === -1 ? len : nl + 1;
    }
    const html = inline(body, link);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  let html = '';
  for (let k = 0; k < blocks.length; k++) html += blocks[k] + '\n';
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INCLUDE = /^include "([a-z0-9-]+)"$/;
const STANDALONE = /^[ \t]*$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = STANDALONE.test(src.slice(lineStart, open)) && STANDALONE.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = T_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node); stack.push(node); body = node.body;
      } else if ((m = T_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node); stack.push(node); body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = []; body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = T_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}
function escapeText(v) { return escapeHtml(textOf(v)); }

function renderNodes(nodes, scope, templates, depth) {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.kind) {
      case 'text': out += n.text; break;
      case 'var': out += escapeText(lookup(scope, n.path)); break;
      case 'raw': out += textOf(lookup(scope, n.path)); break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) out += renderNodes(branch, scope, templates, depth);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const vars = { [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          out += renderNodes(n.body, { vars, parent: scope }, templates, depth);
        }
        break;
      }
      case 'include': {
        const t = templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) out += renderNodes(t, scope, templates, depth + 1);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the build

/** JavaScript's \s set, so counting non-whitespace runs agrees with /\S+/g without allocating the words. */
function isSpaceCode(c) {
  return c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f ||
    c === 0x205f || c === 0x3000 || c === 0xfeff;
}
function wordsOf(text) {
  let n = 0, i = 0;
  const len = text.length;
  while (i < len) {
    while (i < len && isSpaceCode(text.charCodeAt(i))) i++;
    if (i === len) break;
    n++;
    while (i < len && !isSpaceCode(text.charCodeAt(i))) i++;
  }
  return n;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}

/** makefun-site's answer for one case's input. */
export function run(input) {
  const report = [];
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try { templates.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const sites = input.site;
  const siteVars = { title: sites.title, base_url: base };

  const files = input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [], statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  const slugCache = new Map();
  const slugOf = (text) => {
    let s = slugCache.get(text);
    if (s === undefined) { s = slugify(text); slugCache.set(text, s); }
    return s;
  };

  // front matter
  let keptN = 0;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push(`draft ${s.path}`); continue; }
    sources[keptN++] = s;
  }
  sources.length = keptN;

  // permalinks
  const takenByDir = new Map();
  const bySource = new Map();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const p = s.path;
    const slash = p.indexOf('/');
    const dir = s.post ? 'posts' : (slash === -1 ? '' : p.slice(0, p.lastIndexOf('/')));
    let taken = takenByDir.get(dir);
    if (taken === undefined) { taken = new Set(dir === '' ? RESERVED : []); takenByDir.set(dir, taken); }
    const slug = uniqueSlug(s.data.slug ?? slugOf(s.data.title), taken);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // markdown, with link resolution
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const slash = s.path.indexOf('/');
    const dir = slash === -1 ? '' : s.path.slice(0, s.path.lastIndexOf('/'));
    const link = (target) => {
      const c = target.charCodeAt(0);
      if (c === 47 || c === 35) return target;
      if (target.indexOf(':') !== -1 && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, link, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // collections
  const posts = [];
  for (let i = 0; i < sources.length; i++) if (sources[i].post) posts.push(sources[i]);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set(), out = [];
    const tags = s.data.tags ?? [];
    for (let i = 0; i < tags.length; i++) {
      const sl = slugOf(tags[i]);
      if (!seen.has(sl)) { seen.add(sl); out.push(tags[i]); }
    }
    return out;
  };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    p.tagRefs = [];
    const names = ownTags(p);
    for (let k = 0; k < names.length; k++) {
      const name = names[k], slug = slugOf(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s.post) continue;
    const names = ownTags(s);
    s.tagRefs = names.map((name) => bySlug.get(slugOf(name)) ?? { name, slug: slugOf(name), url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : {
    title: s.data.title, url: s.url, date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  });
  function cardOf(s) {
    if (s.card !== undefined) return s.card;
    const refs = s.tagRefs;
    const tagViews = [];
    for (let i = 0; i < refs.length; i++) tagViews.push({ name: refs[i].name, slug: refs[i].slug, url: refs[i].url });
    return (s.card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: tagViews,
    });
  }
  const tagsOf = (t) => ({
    name: t.name, slug: t.slug, url: t.url, count: t.posts.length,
    posts: t.posts.map((p) => cardOf(p)),
  });

  // layouts
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, sites.recent).map((p) => cardOf(p));
  const output = {};
  const render = (name, vars) => {
    const nodes = templates.get(name);
    return nodes === undefined ? null : renderNodes(nodes, { vars: { site: siteVars, tags: allTags, recent, ...vars }, parent: null }, templates, 0);
  };

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const card = cardOf(s);
    const toc = [];
    for (let k = 0; k < s.toc.length; k++) toc.push({ level: s.toc[k].level, id: s.toc[k].id, html: s.toc[k].html });
    const page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }

  const per = sites.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cardOf(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (let i = 0; i < tags.length; i++) {
    const html = render('tag', { tag: tagsOf(tags[i]) });
    if (html !== null) output[`tags/${tags[i].slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = report.concat([...broken]).sort(byCodeUnits);
  const pageCount = sources.reduce((n, s) => n + (s.post ? 0 : 1), 0);
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
