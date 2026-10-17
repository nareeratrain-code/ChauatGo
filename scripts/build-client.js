'use strict';

/* Production client build for Vercel.
   Copies the static site to dist/, minifies JS and inline scripts with
   terser, and does not emit source maps. Top-level names stay so HTML
   onclick="..." handlers keep working. config/env.js stays readable. */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const SKIP_DIRS = new Set([
  'node_modules', 'functions', 'dist', '.git', 'scripts', '.firebase', '.cursor'
]);
const SKIP_FILES = new Set([
  'package.json', 'package-lock.json', 'firebase.json',
  'firestore.rules', 'firestore.indexes.json', '.gitignore'
]);

const TERSER_OPTIONS = {
  compress: {
    drop_console: false,
    passes: 2,
    toplevel: false
  },
  mangle: { toplevel: false },
  sourceMap: false,
  format: { comments: false }
};

const KEEP_NAMES = [
  ['rider.js', 'handleLogout'],
  ['admin.js', 'handleLogout'],
  ['merchant.js', 'switchTab'],
  ['index.html', 'switchTab'],
  ['index.html', 'handleLogout'],
  ['fix.html', 'doLogin']
];

function relFrom(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function shouldSkip(rel) {
  if (!rel) return false;
  const parts = rel.split('/');
  if (parts.some((part) => SKIP_DIRS.has(part) || part.startsWith('.'))) return true;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base)) return true;
  if (base.endsWith('.log') || base.endsWith('.map')) return true;
  return false;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = relFrom(ROOT, abs);
    if (shouldSkip(rel)) continue;
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

async function minifyJs(code, label) {
  const result = await minify(code, TERSER_OPTIONS);
  if (!result || result.error || !result.code) {
    throw new Error('terser failed for ' + label + ': ' + (result && result.error));
  }
  if (result.code.includes('sourceMappingURL')) {
    throw new Error('source map leaked into ' + label);
  }
  return result.code;
}

async function minifyHtml(html, label) {
  const parts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let last = 0;
  let match;
  while ((match = re.exec(html))) {
    parts.push(html.slice(last, match.index));
    const attrs = match[1];
    const code = match[2];
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const skipType = typeMatch && !/javascript/i.test(typeMatch[1]);
    if (/\bsrc\s*=/i.test(attrs) || skipType || !code.trim()) {
      parts.push(match[0]);
    } else {
      const min = await minifyJs(code, label + ' inline');
      parts.push('<script' + attrs + '>' + min + '</script>');
    }
    last = match.index + match[0].length;
  }
  parts.push(html.slice(last));
  return parts.join('');
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  const files = walk(ROOT, []);
  let jsBytes = 0;
  let minBytes = 0;
  for (const abs of files) {
    const rel = relFrom(ROOT, abs);
    const dest = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const ext = path.extname(abs).toLowerCase();
    if (rel === 'config/env.js') {
      fs.copyFileSync(abs, dest);
      continue;
    }
    if (ext === '.js') {
      const code = fs.readFileSync(abs, 'utf8');
      const min = await minifyJs(code, rel);
      fs.writeFileSync(dest, min);
      jsBytes += Buffer.byteLength(code);
      minBytes += Buffer.byteLength(min);
      continue;
    }
    if (ext === '.html') {
      const html = fs.readFileSync(abs, 'utf8');
      const min = await minifyHtml(html, rel);
      fs.writeFileSync(dest, min);
      continue;
    }
    fs.copyFileSync(abs, dest);
  }

  const env = fs.readFileSync(path.join(DIST, 'config/env.js'), 'utf8');
  if (!env.includes('REPLACE_WITH_RECAPTCHA_V3_SITE_KEY') || !env.includes('Phone steps')) {
    throw new Error('config/env.js was minified or dropped');
  }
  for (const [file, name] of KEEP_NAMES) {
    const text = fs.readFileSync(path.join(DIST, file), 'utf8');
    if (!text.includes(name)) throw new Error(file + ' lost global ' + name);
    if (text.includes('sourceMappingURL')) throw new Error(file + ' contains a source map');
  }
  const maps = [];
  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(abs);
      else if (entry.name.endsWith('.map')) maps.push(abs);
    }
  })(DIST);
  if (maps.length) throw new Error('source maps were written: ' + maps.join(', '));
  const saved = jsBytes ? Math.round((1 - minBytes / jsBytes) * 100) : 0;
  console.log('built dist/ — js ' + jsBytes + ' → ' + minBytes + ' bytes (' + saved + '% smaller), no source maps');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
