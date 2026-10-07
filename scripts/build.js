const esbuild = require('esbuild');
const path = require('node:path');

const production = process.argv.includes('--production');

esbuild
  .build({
    absWorkingDir: path.resolve(__dirname, '..'),
    entryPoints: ['src/extension.ts', 'src/captureReporter.ts', 'src/selectorWorker.ts'],
    bundle: true,
    outdir: 'dist',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
  })
  .catch(() => process.exit(1));
