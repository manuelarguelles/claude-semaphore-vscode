const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
};

if (watch) {
  esbuild.context(opts).then((ctx) => ctx.watch());
} else {
  Promise.all([
    esbuild.build(opts),
    esbuild.build({ entryPoints: ['scripts/session-hook.cjs'], bundle: true, outfile: 'out/session-hook.cjs', platform: 'node', format: 'cjs', target: 'node18' }),
  ]).catch(() => process.exit(1));
}
