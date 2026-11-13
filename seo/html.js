// Small HTML string helpers used by the SEO/prerender pipeline (no DOM dependency; the markup of this project is regular).
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const escAttr = esc;
export const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const ATTRS = String.raw`(?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*`;
// comments / script / style are matched first so that markup inside them is ignored
const TOKEN = new RegExp(String.raw`<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<([a-zA-Z][\w-]*)(${ATTRS})\s*(\/?)>`, 'g');

export const getAttr = (attrs, name) => {
  const m = attrs.match(new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : null;
};
export const setAttr = (attrs, name, value) => {
  const re = new RegExp(String.raw`(\s)${name}\s*=\s*(?:"[^"]*"|'[^']*')`);
  const a = `${name}="${escAttr(value)}"`;
  return re.test(attrs) ? attrs.replace(re, `$1${a}`) : `${attrs} ${a}`;
};

function findClose(html, tag, from) {
  const re = new RegExp(String.raw`<!--[\s\S]*?-->|<(/?)${tag}\b[^>]*?(\/?)>`, 'gi');
  re.lastIndex = from;
  let depth = 1; let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { if (--depth === 0) return m.index; } else if (!m[2]) depth++;
  }
  return -1;
}

/** Apply i18n to every [data-i18n], [data-i18n-html] and [data-i18n-attr] element. get(key, lang?) -> string|undefined. */
export function applyI18n(html, get, lang, urlFn) {
  let out = ''; let pos = 0; let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (!m[1]) continue;
    const tag = m[1]; let attrs = m[2];
    const forced = getAttr(attrs, 'data-i18n-lang');
    const g = (k) => get(k, forced || lang);
    const key = getAttr(attrs, 'data-i18n'); const keyHtml = getAttr(attrs, 'data-i18n-html'); const keyAttr = getAttr(attrs, 'data-i18n-attr');
    if (key == null && keyHtml == null && keyAttr == null) continue;
    if (keyAttr != null) {
      keyAttr.split(';').forEach((pair) => {
        const i = pair.indexOf(':'); const attr = pair.slice(0, i); const v = g(pair.slice(i + 1));
        if (attr && typeof v === 'string') attrs = setAttr(attrs, attr, v.startsWith('/') ? urlFn(v) : v);
      });
    }
    const inner = key != null ? (g(key) != null ? esc(g(key)) : null) : keyHtml != null && g(keyHtml) != null ? g(keyHtml).replace(/<br\s*\/?>/gi, ' <br>') : null;
    let open = `<${tag}${attrs}${m[3] ? ' /' : ''}>`;
    if ((key != null || keyHtml != null) && inner != null) open = open.replace(/>$/, ' data-i18n-done>');
    if (inner == null || m[3]) { out += html.slice(pos, m.index) + open; pos = m.index + m[0].length; continue; }
    const close = findClose(html, tag, m.index + m[0].length);
    if (close < 0) { out += html.slice(pos, m.index) + open; pos = m.index + m[0].length; continue; }
    out += html.slice(pos, m.index) + open + inner;
    pos = close; TOKEN.lastIndex = close;
  }
  return out + html.slice(pos);
}

/** Collect headings (outside comments/scripts and [hidden] subtrees is NOT handled here; the audit does the hidden filtering). */
export function headings(html) {
  const out = []; const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi; let m;
  const body = html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/g, '');
  while ((m = re.exec(body))) out.push({ level: +m[1], attrs: m[2], text: stripTags(m[3]) });
  return out;
}
