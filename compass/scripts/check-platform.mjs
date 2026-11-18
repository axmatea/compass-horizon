import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function check(path) {
  for(const entry of await readdir(path,{withFileTypes:true})) {
    if(entry.name==='node_modules')continue;
    const file=path+'/'+entry.name;
    if(entry.isDirectory())await check(file);
    else if(/\.(?:mjs|js)$/.test(file)) {
      const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
      if(result.status!==0)process.exit(result.status||1);
    }
  }
}
for(const path of ['account','platform','billing','integrations','generation','sandbox','html','marketplace','src/account','src/applications','src/create','src/builder','src/studio','src/help','src/start','src/marketplace'])await check(path);
for(const path of ['src/site/public-navigation.mjs','src/site/preview-fragments.mjs']) {
  const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
