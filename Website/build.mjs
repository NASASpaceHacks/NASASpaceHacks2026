// Assemble index.html from src/ parts:  node build.mjs
import fs from 'node:fs';
const d = new URL('.', import.meta.url).pathname;
const read = (p) => fs.readFileSync(d + p, 'utf8');
const secs = fs.readdirSync(d + 'src/sections').filter((f) => f.endsWith('.html')).sort()
  .map((f) => `\n<!-- ${f} -->\n` + read('src/sections/' + f)).join('\n');
fs.writeFileSync(d + 'index.html', read('src/head.html') + read('src/hero.html') + '\n<main id="main">' + secs + '\n</main>\n' + read('src/foot.html'));
console.log('built index.html');
