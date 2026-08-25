/* Inline p5 and every source module into self-contained pages.
   Emits:
     dist/graphite-kinematics.html   a complete standalone document
     dist/artifact.html              content only, for hosts that supply the shell
   Usage: node build.mjs                                                     */
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SRC = ['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil',
  '50-features', '55-dorsal', '60-render', '70-app'];

// Split the page BEFORE anything is inlined. A minified library contains
// plenty of strings that look like markup, and searching for </head> after
// splicing it in finds one of those instead of the real tag.
const page = read('index.html');
const headInner = page.slice(page.indexOf('<head>') + 6, page.indexOf('</head>'));
const bodyInner = page.slice(page.indexOf('<body>') + 6, page.lastIndexOf('</body>'));

// Strip every script tag out of both halves; they are re-emitted inlined.
const dropScripts = (s) => s.replace(/[ \t]*<script src="[^"]+"><\/script>\n?/g, '');
const headParts = dropScripts(headInner).trim();
const bodyParts = dropScripts(bodyInner).trim();

// Replace via a function, never a string: a plain string replacement expands
// $&, $' and $`, and minified sources are full of them.
const esc = (js) => js.replace(/<\/script>/gi, '<\\/script>');
const bundle = ['vendor/p5.min.js', ...SRC.map(n => 'src/' + n + '.js')]
  .map(p => '<script>\n' + esc(read(p)) + '\n</script>')
  .join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

fs.writeFileSync(path.join(root, 'dist/graphite-kinematics.html'),
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + headParts + '\n</head>\n<body>\n' +
  bodyParts + '\n' + bundle + '\n</body>\n</html>\n');

// The artifact host supplies doctype, html, head and body. Hand it the title
// first so it is found inside the scanned prefix, then styles, then markup,
// then the scripts.
const artifact = headParts
  .split('\n').filter(l => !/<meta\s/i.test(l)).join('\n').trim();
fs.writeFileSync(path.join(root, 'dist/artifact.html'),
  artifact + '\n' + bodyParts + '\n' + bundle + '\n');

const kb = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(0) + ' kB';
console.log('dist/graphite-kinematics.html  ' + kb('dist/graphite-kinematics.html'));
console.log('dist/artifact.html             ' + kb('dist/artifact.html'));
const head8k = fs.readFileSync(path.join(root, 'dist/artifact.html'), 'utf8').slice(0, 8192);
console.log('title inside the scanned prefix: ' + /<title>/.test(head8k));
