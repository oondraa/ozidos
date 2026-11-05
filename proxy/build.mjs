/**
 * Sestaví prostředníka pro Vercel ve formátu „Build Output API v3“ (.vercel/output),
 * který se nasadí příkazem:  npx vercel deploy --prebuilt --prod
 * Celá funkce se zabalí do jednoho souboru, takže nezáleží na tom, jak Vercel překládá TypeScript.
 */
import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const out = new URL('../.vercel/output/', import.meta.url);
const fn = new URL('functions/api.func/', out);

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: [new URL('handler.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  outfile: new URL('index.mjs', fn).pathname.replace(/^\/(\w:)/, '$1'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Některé závislosti v ESM potřebují require – Node ho v .mjs nemá.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

await writeFile(
  new URL('.vc-config.json', fn),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 15 }),
);
await writeFile(new URL('package.json', fn), JSON.stringify({ type: 'module' }));
// všechny cesty /api/* obslouží jedna funkce
await writeFile(
  new URL('config.json', out),
  JSON.stringify({ version: 3, routes: [{ src: '/api/(.*)', dest: '/api' }] }, null, 2),
);
console.log('Hotovo: .vercel/output');
