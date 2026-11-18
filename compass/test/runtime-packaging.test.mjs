import test from 'node:test'
import assert from 'node:assert/strict'
import {cp,mkdtemp,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

test('Docker runtime source can import the complete production server graph',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url))
  const docker=await readFile(join(root,'Dockerfile'),'utf8')
  const runtime=docker.split(/\nFROM [^\n]+ AS runtime\n/)[1]
  assert.ok(runtime,'Production runtime stage must be present')
  const temporary=await mkdtemp(join(tmpdir(),'compass-runtime-'))
  try {
    for(const line of runtime.split('\n').filter(line=>line.startsWith('COPY '))) {
      const parts=line.split(/\s+/).slice(1).filter(part=>!part.startsWith('--'))
      const destination=parts.pop()
      for(const source of parts) {
        const path=source.replace(/^\/app\//,'')
        if(['dist','node_modules'].includes(path))continue
        assert.ok(!path.startsWith('/') && !path.includes('..'))
        const target=destination==='./'?join(temporary,path):resolve(temporary,destination)
        assert.ok(target.startsWith(temporary+'/'))
        await cp(join(root,path),target,{recursive:true})
      }
    }
    await symlink(join(root,'node_modules'),join(temporary,'node_modules'),'dir')
    const result=await promisify(execFile)(process.execPath,['--input-type=module','--eval',"await import('./server.mjs'); console.log('runtime-import-ok')"],{cwd:temporary,timeout:15000})
    assert.match(result.stdout,/runtime-import-ok/)
  } finally {await rm(temporary,{recursive:true,force:true})}
})
