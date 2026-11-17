import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {validateTourManifest} from '../src/help/model.mjs'

const folder=new URL('../public/assets/tutorial/',import.meta.url)
const manifest=JSON.parse(await readFile(new URL('platform-tour.json',folder),'utf8'))
const provenance=JSON.parse(await readFile(new URL('provenance.json',folder),'utf8'))
const local=url=>{
  assert.match(url,/^\/assets\/tutorial\/[A-Za-z0-9_-]+\.(?:webp|png|jpe?g|vtt|mp4)$/)
  return new URL(url.slice('/assets/tutorial/'.length),folder)
}

function webpDimensions(bytes) {
  assert.equal(bytes.toString('ascii',0,4),'RIFF')
  assert.equal(bytes.toString('ascii',8,12),'WEBP')
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length)
  for(let offset=12;offset+8<=bytes.length;) {
    const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),data=offset+8
    assert.ok(data+size<=bytes.length,'WebP chunk must not exceed the file')
    if(kind==='VP8X')return [bytes.readUIntLE(data+4,3)+1,bytes.readUIntLE(data+7,3)+1]
    if(kind==='VP8 ') {
      assert.equal(bytes.subarray(data+3,data+6).toString('hex'),'9d012a')
      return [bytes.readUInt16LE(data+6)&0x3fff,bytes.readUInt16LE(data+8)&0x3fff]
    }
    if(kind==='VP8L') {
      assert.equal(bytes[data],0x2f)
      const packed=bytes.readUInt32LE(data+1)
      return [(packed&0x3fff)+1,((packed>>>14)&0x3fff)+1]
    }
    offset=data+size+(size%2)
  }
  assert.fail('WebP must contain an image header')
}

test('shipped tour manifest is accepted by the player and every media URL exists locally',async()=>{
  assert.deepEqual(validateTourManifest(manifest),manifest)
  assert.equal(manifest.chapters.length,11)
  assert.equal(manifest.chapters[0].start,0)
  assert.equal(manifest.chapters.at(-1).end,manifest.duration)
  assert.deepEqual(provenance.missingScreens,[])
  assert.match(manifest.chapters.at(-1).screen,/\/usage-[a-f0-9]{10}\.webp$/)
  assert.match(manifest.chapters.at(-1).alt,/Actual Usage panel/)
  const paths=[...manifest.chapters.map(chapter=>chapter.screen),manifest.captions,manifest.video].filter(Boolean)
  for(const url of new Set(paths))assert.ok((await stat(local(url))).isFile(),url)
})

test('actual product screens have valid WebP dimensions, content hashes and a complete provenance entry',async()=>{
  const urls=new Set(manifest.chapters.map(chapter=>chapter.screen))
  assert.equal(provenance.assets.length,urls.size)
  let total=0
  for(const url of urls) {
    const record=provenance.assets.find(asset=>asset.url===url)
    assert.ok(record,'Missing provenance for '+url)
    const bytes=await readFile(local(url)),hash=createHash('sha256').update(bytes).digest('hex')
    assert.equal(record.sha256,hash)
    assert.ok(url.endsWith('-'+hash.slice(0,10)+'.webp'),'Filename must hash the derived image')
    assert.match(record.sourceSHA256,/^[a-f0-9]{64}$/)
    assert.equal(record.bytes,bytes.length)
    const [width,height]=webpDimensions(bytes)
    assert.deepEqual([record.width,record.height],[width,height])
    assert.ok(width>=400 && height>=400 && width<=1280 && height<=1280,'Keep real screens readable and bounded')
    total+=bytes.length
  }
  assert.ok(total<1_000_000,'Guide screenshots must remain under 1 MB total')
})

test('English captions cover the complete chapter timeline with matching titles and instructions',async()=>{
  const text=await readFile(local(manifest.captions),'utf8')
  const blocks=text.trim().split(/\r?\n\r?\n/)
  assert.equal(blocks.shift(),'WEBVTT')
  assert.equal(blocks.length,manifest.chapters.length)
  const seconds=time=>{assert.match(time,/^\d{2}:\d{2}:\d{2}\.\d{3}$/);return time.split(':').reduce((sum,part)=>sum*60+Number(part),0)}
  const unescape=text=>text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  blocks.forEach((block,index)=>{
    const [id,timing,title,...instruction]=block.split(/\r?\n/),chapter=manifest.chapters[index]
    const [start,end]=timing.split(' --> ')
    assert.equal(id,chapter.id)
    assert.equal(seconds(start),chapter.start)
    assert.equal(seconds(end),chapter.end)
    assert.equal(unescape(title),chapter.title)
    assert.equal(unescape(instruction.join('\n')),chapter.instruction)
  })
})

test('interactive product screens are explicitly distinguished from a screen recording',async()=>{
  const readme=await readFile(new URL('README.md',folder),'utf8')
  if(manifest.kind==='interactive') {
    assert.equal(manifest.video,null)
    assert.equal(provenance.recordedTutorial,null)
    assert.equal(provenance.mode,'interactive-product-screens')
    assert.equal(provenance.legacyScreenMontageUsedAsRecording,false)
    assert.match(readme,/not a screen recording/i)
    assert.match(provenance.videoStatus,/No current instructional recording/)
    assert.ok(!(await readdir(folder)).some(name=>/\.(?:mp4|mov|webm)$/i.test(name)))
  } else {
    assert.equal(manifest.kind,'video')
    assert.ok(manifest.video)
    assert.ok(provenance.recordedTutorial)
  }
})

test('screen font license notices are shipped with the guide',async()=>{
  assert.deepEqual(provenance.licenses,['licenses/sora-OFL.txt','licenses/inter-OFL.txt'])
  for(const path of provenance.licenses) {
    const notice=await readFile(new URL(path,folder),'utf8')
    assert.match(notice,/SIL OPEN FONT LICENSE/i)
    assert.match(notice,/Version 1\.1/)
  }
})
