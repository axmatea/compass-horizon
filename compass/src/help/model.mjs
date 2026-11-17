const text=(value,max)=>typeof value==='string' && value.trim() && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null
const asset=(value,extensions)=>typeof value==='string' && value.length<=240 && /^\/assets\/tutorial\/[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value) && !value.split('/').includes('..') && extensions.some(extension=>value.endsWith('.'+extension)) ? value : null

export function validateTourManifest(value) {
  if(!value || value.version!==1 || !['interactive','video'].includes(value.kind) || !text(value.title,80)
    || !Number.isFinite(value.duration) || value.duration<1 || value.duration>900 || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length>24)return null
  const video=value.video===null ? null : asset(value.video,['mp4','webm'])
  const captions=value.captions==null ? null : asset(value.captions,['vtt'])
  if(value.kind==='video' && !video || value.kind==='interactive' && value.video!==null || value.captions!=null && !captions)return null
  const ids=new Set(),chapters=[]
  let end=0
  for(const chapter of value.chapters) {
    if(!chapter || typeof chapter.id!=='string' || !/^[a-z][a-z0-9-]{0,47}$/.test(chapter.id) || ids.has(chapter.id)
      || !text(chapter.title,80) || !text(chapter.instruction,500) || !text(chapter.alt,240)
      || !Number.isFinite(chapter.start) || !Number.isFinite(chapter.end) || chapter.start!==end || chapter.end<=chapter.start || chapter.end>value.duration)return null
    const screen=asset(chapter.screen,['png','jpg','jpeg','webp'])
    if(!screen)return null
    ids.add(chapter.id);end=chapter.end
    chapters.push({id:chapter.id,title:chapter.title.trim(),start:chapter.start,end:chapter.end,instruction:chapter.instruction.trim(),screen,alt:chapter.alt.trim()})
  }
  if(end!==value.duration)return null
  return {version:1,kind:value.kind,title:value.title.trim(),video,captions,duration:value.duration,chapters}
}

export function chapterAtTime(manifest,time) {
  const at=Math.max(0,Math.min(Number.isFinite(time)?time:0,manifest.duration))
  return Math.max(0,manifest.chapters.findIndex(chapter=>at>=chapter.start && (at<chapter.end || chapter.end===manifest.duration)))
}

export function formatTourTime(value) {
  const seconds=Math.max(0,Math.floor(Number.isFinite(value)?value:0))
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')
}

export function createTourState() {return {time:0,playing:false,captions:true,ended:false}}

export function reduceTourState(manifest,state,action) {
  let next={...state}
  const clamp=value=>Math.max(0,Math.min(Number.isFinite(value)?value:state.time,manifest.duration))
  if(action.type==='play')next={...next,time:state.ended?0:state.time,playing:true,ended:false}
  else if(action.type==='pause')next.playing=false
  else if(action.type==='replay')next={...next,time:0,playing:true,ended:false}
  else if(action.type==='captions')next.captions=!state.captions
  else if(action.type==='jump' && Number.isInteger(action.index) && manifest.chapters[action.index])next.time=manifest.chapters[action.index].start
  else if(action.type==='seek')next.time=clamp(action.time)
  else if(action.type==='tick' && state.playing)next.time=clamp(state.time+Math.max(0,Math.min(Number.isFinite(action.seconds)?action.seconds:0,2)))
  else return state
  next.ended=next.time>=manifest.duration
  if(next.ended)next.playing=false
  return next
}
