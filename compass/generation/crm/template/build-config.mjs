import {resolve} from 'node:path';

export function buildCrmFrontend(build, {root, outDir}) {
  return build({
    root,
    configFile: false,
    envDir: false,
    publicDir: false,
    define: {'process.env.NODE_ENV': JSON.stringify('production')},
    esbuild: {jsx: 'automatic'},
    build: {
      target: 'es2022',
      outDir,
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: 'esbuild',
      sourcemap: false,
      lib: {entry: resolve(root, 'src/main.tsx'), name: 'CompassCrm', formats: ['iife'],
        fileName: () => 'crm.js', cssFileName: 'crm'},
    },
  });
}
