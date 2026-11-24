import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {buildCrmFrontend} from './build-config.mjs';

await buildCrmFrontend(build, {
  root: fileURLToPath(new URL('.', import.meta.url)),
  outDir: fileURLToPath(new URL('./public/', import.meta.url)),
});
