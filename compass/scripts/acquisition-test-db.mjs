// Local-only PostgreSQL for reproducible tests. Never uses production variables.
import EmbeddedPostgres from 'embedded-postgres';
import {mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve('.cache/acquisition-test-pg');
await mkdir(dir,{recursive:true});
const pg=new EmbeddedPostgres({databaseDir:dir,port:55438,user:'compass_test',password:'local-test-only',persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
try{await stat(resolve(dir,'PG_VERSION'));}catch{await pg.initialise();}
await pg.start();
try{await pg.createDatabase('compass_test');}catch(e){if(e.code!=='42P04')throw e;}
console.log('Local PostgreSQL test database ready at 127.0.0.1:55438 (compass_test). No production services used.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await pg.stop();process.exit(0);});
setInterval(()=>{},60000);
