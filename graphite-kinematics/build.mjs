/* Inline p5 and every source module into self-contained pages.
   Emits:
     dist/graphite-kinematics.html   a complete standalone document
     dist/artifact.html              content only, for hosts that supply the shell
   Usage: node build.mjs                                                     */
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SRC = ['00-math', '10-anatomy', '20-rig', '30-pose', '35-physics', '40-pencil',
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
// The same rule as data-local-only, applied to source rather than markup.
// Stripping only the button would leave the save path in the artifact as
// unreachable text - and unreachable or not, an <a download> with a blob:
// href in a published page is still an offer the host will never honour.
const dropLocalOnlyJS = (js) =>
  js.replace(/^[ \t]*\/\* local-only:start[\s\S]*?local-only:end \*\/[ \t]*\n?/gm, '');
const sources = ['vendor/p5.min.js', ...SRC.map(n => 'src/' + n + '.js')];
const wrap = (js) => '<script>\n' + esc(js) + '\n</script>';
const bundle = sources.map(p => wrap(read(p))).join('\n');
const bundleShared = sources.map(p => wrap(dropLocalOnlyJS(read(p)))).join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

fs.writeFileSync(path.join(root, 'dist/graphite-kinematics.html'),
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + headParts + '\n</head>\n<body>\n' +
  bodyParts + '\n' + bundle + '\n</body>\n</html>\n');

// Anything marked data-local-only is dropped from the artifact build. The
// artifact host runs the page in a sandbox that blocks any download the page
// starts itself - both an <a download> and a script-driven save - so a save
// button there is not a feature that is switched off, it is a control that
// reports success and does nothing. It stays in the standalone build, where
// the file is opened directly and it works.
const dropLocalOnly = (s) => s.replace(/^[ \t]*<[^>]*\sdata-local-only[\s\S]*?<\/[a-zA-Z]+>[ \t]*\n?/gm, '');

// The artifact host supplies doctype, html, head and body. Hand it the title
// first so it is found inside the scanned prefix, then styles, then markup,
// then the scripts.
const artifact = headParts
  .split('\n').filter(l => !/<meta\s/i.test(l)).join('\n').trim();
fs.writeFileSync(path.join(root, 'dist/artifact.html'),
  artifact + '\n' + dropLocalOnly(bodyParts) + '\n' + bundleShared + '\n');

const kb = (p) => (fs.statSync(path.join(root, p)).size / 1024).toFixed(0) + ' kB';
console.log('dist/graphite-kinematics.html  ' + kb('dist/graphite-kinematics.html'));
console.log('dist/artifact.html             ' + kb('dist/artifact.html'));
const head8k = fs.readFileSync(path.join(root, 'dist/artifact.html'), 'utf8').slice(0, 8192);
console.log('title inside the scanned prefix: ' + /<title>/.test(head8k));
