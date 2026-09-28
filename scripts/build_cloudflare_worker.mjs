import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'dist');
const entry = path.join(projectRoot, 'src', 'worker', 'index.ts');
const [workerBuild] = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    lib: { entry, formats: ['es'], fileName: () => '_worker.js' },
    rollupOptions: {
      output: { format: 'es', inlineDynamicImports: true }
    }
  }
});

if (!('output' in workerBuild)) throw new Error('Cloudflare worker build did not produce output.');
const workerBundle = workerBuild.output.find(item => item.type === 'chunk' && item.fileName === '_worker.js');
if (!workerBundle || workerBundle.type !== 'chunk') throw new Error('Cloudflare worker bundle is missing.');

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, '_worker.js'), workerBundle.code, 'utf8');
await writeFile(path.join(outputDirectory, '_routes.json'), JSON.stringify({
  version: 1,
  include: ['/api/official-source'],
  exclude: []
}, null, 2) + '\n', 'utf8');
await writeFile(path.join(outputDirectory, '.assetsignore'), '/_worker.js\n/_routes.json\n/.assetsignore\n', 'utf8');
console.log('Built Cloudflare static-asset worker at dist/_worker.js');
