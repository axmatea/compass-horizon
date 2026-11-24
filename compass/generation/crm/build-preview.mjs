import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {buildCrmFrontend} from './template/build-config.mjs';

await buildCrmFrontend(build,{
  root:fileURLToPath(new URL('./template/',import.meta.url)),
  outDir:fileURLToPath(new URL('../../dist/internal-crm/',import.meta.url)),
});
