import {validateTourManifest,createTourState,reduceTourState,chapterAtTime,formatTourTime} from './model.mjs'
import './platform-tour.css'

let serial=0

// This help surface never receives project data, identity, storage or callbacks.
export function mountPlatformTour({trigger,manifestUrl='/assets/tutorial/platform-tour.json',document:doc=globalThis.document,window:view=globalThis.window,fetch:request=globalThis.fetch}={}) {
  if(!trigger?.addEventListener || !doc?.body || !/^\/assets\/tutorial\/[A-Za-z0-9_-]+\.json$/.test(manifestUrl))throw new TypeError('Invalid tour configuration')
  const id='compass-tour-'+(++serial),listeners=[]
  let ui,manifest,state=createTourState(),kind,opened=false,disposed=false,controller,loading,frame,closing,lastTick,focusBefore,bodyOverflow='',paintedChapter=-1,mediaEpoch=0,screenFailed=false
  const setTimer=(work,delay)=>view?.setTimeout?view.setTimeout(work,delay):setTimeout(work,delay)
  const clearTimer=timer=>view?.clearTimeout?view.clearTimeout(timer):clearTimeout(timer)
  const raf=work=>view?.requestAnimationFrame?view.requestAnimationFrame(work):setTimer(()=>work(Date.now()),32)
  const cancelFrame=timer=>view?.cancelAnimationFrame?view.cancelAnimationFrame(timer):clearTimer(timer)
  const reduced=()=>view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true
  const on=(target,type,work)=>{target.addEventListener(type,work);listeners.push(()=>target.removeEventListener(type,work))}
  const element=(tag,text,className)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node}
  function button(text,action,className='pt-button') {
    const node=element('button',text,className);node.type='button';node.dataset.tour=action;return node
  }
  function notice(text='') {ui.status.textContent=text;ui.status.hidden=!text}
  function stopFrame() {if(frame!=null)cancelFrame(frame);frame=null;lastTick=undefined}
  function dispatch(action) {state=reduceTourState(manifest,state,action);paint();return state}
  function applyCaptions() {
    if(!ui)return
    for(const track of Array.from(ui.video.textTracks || []))if(track.kind==='captions')track.mode=state.captions?'showing':'hidden'
  }
  function paint() {
    if(!manifest || !ui)return
    const index=chapterAtTime(manifest,state.time),chapter=manifest.chapters[index]
    ui.play.textContent=state.playing?'Pause':kind==='video'?'Play video':'Play guide'
    ui.play.setAttribute('aria-label',state.playing?'Pause tour':kind==='video'?'Play tutorial video':'Play interactive guide')
    ui.play.setAttribute('aria-pressed',String(state.playing))
    ui.progress.value=String(state.time);ui.progress.setAttribute('aria-valuetext',formatTourTime(state.time)+' of '+formatTourTime(manifest.duration))
    ui.time.textContent=formatTourTime(state.time)+' / '+formatTourTime(manifest.duration)
    ui.captions.setAttribute('aria-pressed',String(state.captions))
    ui.captions.setAttribute('aria-controls',kind==='video'?id+'-video':id+'-captions')
    ui.captions.disabled=kind==='video' && !manifest.captions
    ui.caption.hidden=kind==='video' || !state.captions
    ui.instruction.hidden=kind!=='video'
    if(index!==paintedChapter) {
      if(screenFailed)notice()
      paintedChapter=index;screenFailed=false;ui.heading.textContent=chapter.title;ui.caption.textContent=chapter.instruction;ui.instruction.textContent=chapter.instruction
      ui.image.src=chapter.screen;ui.image.alt=chapter.alt
      ui.chapterButtons.forEach((node,n)=>{if(n===index)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current')})
    }
    ui.dialog.dataset.kind=kind
    ui.kind.textContent=kind==='video'?'Video tutorial':'Interactive guide · Product screens'
    ui.image.hidden=kind==='video' || screenFailed;ui.video.hidden=kind!=='video'
  }
  function schedule() {
    stopFrame()
    if(!opened || !state.playing || kind!=='interactive')return
    function tick(now) {
      frame=null
      if(!opened || !state.playing)return
      if(lastTick!==undefined)dispatch({type:'tick',seconds:(now-lastTick)/1000})
      lastTick=now
      if(state.playing)frame=raf(tick);else lastTick=undefined
    }
    frame=raf(tick)
  }
  async function play(replay=false) {
    if(!manifest || !opened)return
    notice()
    if(kind==='video') {
      const mine=++mediaEpoch
      if(replay || state.ended)ui.video.currentTime=0
      try {await ui.video.play();if(opened && mine===mediaEpoch)dispatch({type:replay?'replay':'play'});else if(!opened)ui.video.pause()}
      catch {if(opened && mine===mediaEpoch)notice('Playback couldn’t start. Try Play again.')}
    } else {dispatch({type:replay?'replay':'play'});schedule()}
  }
  function pause() {mediaEpoch++;stopFrame();if(manifest)dispatch({type:'pause'});ui?.video.pause()}
  function seek(time) {
    if(!manifest)return
    dispatch({type:'seek',time})
    if(kind==='video')ui.video.currentTime=state.time
    if(!state.playing)pause();else schedule()
  }
  function finishClose() {
    if(opened || !ui)return
    if(ui.dialog.open && typeof ui.dialog.close==='function')ui.dialog.close();else ui.dialog.removeAttribute('open')
    ui.dialog.classList.remove('is-closing');doc.body.style.overflow=bodyOverflow
    const target=focusBefore?.isConnected===false?trigger:focusBefore || trigger
    target?.focus?.({preventScroll:true});focusBefore=null
  }
  function close() {
    if(!ui || !opened)return
    opened=false;pause();controller?.abort();loading=null
    trigger.setAttribute('aria-expanded','false');ui.dialog.classList.remove('is-open')
    if(doc.fullscreenElement && ui.player.contains(doc.fullscreenElement))void doc.exitFullscreen?.().catch(()=>{})
    if(reduced()){finishClose();return}
    ui.dialog.classList.add('is-closing');closing=setTimer(()=>{closing=null;finishClose()},240)
  }
  function keydown(event) {
    if(!opened)return
    // Workspace shortcuts must not edit or submit the project behind the guide.
    event.stopPropagation()
    if(event.key==='Escape'){event.preventDefault();if(doc.fullscreenElement)void doc.exitFullscreen?.().catch(()=>{});else close();return}
    if(event.key!=='Tab')return
    const scope=doc.fullscreenElement && ui.dialog.contains(doc.fullscreenElement)?doc.fullscreenElement:ui.dialog
    const items=Array.from(scope.querySelectorAll('button,input,[href]')).filter(node=>!node.disabled && !node.hidden && !node.closest('[hidden]'))
    if(!items.length){event.preventDefault();ui.dialog.focus();return}
    const first=items[0],last=items.at(-1),active=doc.activeElement
    if(event.shiftKey && (active===first || !scope.contains(active))){event.preventDefault();last.focus()}
    else if(!event.shiftKey && (active===last || !scope.contains(active))){event.preventDefault();first.focus()}
  }
  function create() {
    const dialog=element('dialog',null,'platform-tour');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1
    const shell=element('div',null,'pt-shell'),header=element('header',null,'pt-header'),title=element('h2','Platform Tour'),exit=button('×','close','pt-close')
    title.id=id+'-title';exit.setAttribute('aria-label','Close Platform Tour');header.append(title,exit)
    const body=element('div',null,'pt-body'),navigation=element('nav',null,'pt-chapters'),navTitle=element('h3','Explore'),chapters=element('ol')
    navigation.setAttribute('aria-label','Tour chapters');navigation.append(navTitle,chapters)
    const player=element('section',null,'pt-player'),kindLabel=element('p','Product guide','pt-kind'),heading=element('h3','Getting ready…','pt-heading'),stage=element('div',null,'pt-stage'),image=element('img'),video=element('video'),caption=element('p',null,'pt-caption'),instruction=element('p',null,'pt-instruction')
    player.setAttribute('aria-label','Platform Tour player');player.setAttribute('aria-busy','true');image.hidden=video.hidden=caption.hidden=instruction.hidden=true;image.decoding='async'
    video.id=id+'-video';video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label','COMPASS platform tutorial')
    caption.id=id+'-captions';caption.setAttribute('aria-live','polite');caption.setAttribute('aria-atomic','true');stage.append(image,video)
    const progressRow=element('div',null,'pt-progress'),progress=element('input'),time=element('output','0:00','pt-time')
    progress.type='range';progress.min='0';progress.max='1';progress.step='0.1';progress.value='0';progress.setAttribute('aria-label','Tour progress');progress.disabled=true;progress.dataset.tour='progress';progressRow.append(progress,time)
    time.setAttribute('aria-live','off')
    const controls=element('div',null,'pt-controls'),playButton=button('Play guide','play','pt-button pt-play'),replay=button('Replay','replay'),captions=button('Captions','captions'),fullscreen=button('Fullscreen','fullscreen')
    captions.setAttribute('aria-pressed','true');playButton.setAttribute('aria-pressed','false');fullscreen.hidden=typeof player.requestFullscreen!=='function'
    for(const node of [playButton,replay,captions,fullscreen])node.disabled=true
    controls.append(playButton,replay,captions,fullscreen)
    const status=element('p','Loading tour…','pt-status'),retry=button('Try again','retry');status.setAttribute('role','status');retry.hidden=true
    player.append(kindLabel,heading,stage,caption,instruction,progressRow,controls,status,retry);body.append(navigation,player);shell.append(header,body);dialog.append(shell);doc.body.append(dialog)
    ui={dialog,player,kind:kindLabel,heading,image,video,caption,instruction,progress,time,play:playButton,replay,captions,fullscreen,status,retry,chapters,chapterButtons:[],exit}
    on(exit,'click',close);on(dialog,'cancel',event=>{event.preventDefault();close()});on(dialog,'keydown',keydown)
    on(dialog,'click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)close()})
    on(playButton,'click',()=>{if(state.playing)pause();else void play()});on(replay,'click',()=>void play(true))
    on(progress,'input',()=>seek(Number(progress.value)))
    on(captions,'click',()=>{if(!manifest)return;dispatch({type:'captions'});applyCaptions()})
    on(retry,'click',()=>void load())
    on(fullscreen,'click',async()=>{try{if(doc.fullscreenElement===player)await doc.exitFullscreen();else await player.requestFullscreen()}catch{notice('Fullscreen is unavailable. You can keep using the tour here.')}})
    on(doc,'fullscreenchange',()=>{fullscreen.textContent=doc.fullscreenElement===player?'Exit fullscreen':'Fullscreen'})
    on(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden')pause()})
    on(video,'timeupdate',()=>{if(kind==='video' && manifest)dispatch({type:'seek',time:video.currentTime})})
    on(video,'ended',()=>{if(kind==='video' && manifest)dispatch({type:'seek',time:manifest.duration})})
    on(video,'pause',()=>{if(kind==='video' && manifest)dispatch({type:'pause'})})
    on(video,'error',()=>{if(!manifest || kind!=='video')return;pause();kind='interactive';paintedChapter=-1;paint();notice('Video is unavailable. Explore the product screens instead.')})
    on(image,'error',()=>{if(kind==='interactive'){screenFailed=true;ui.image.hidden=true;notice('This screen couldn’t load. Choose another chapter or read the captions.')}})
  }
  async function load() {
    if(loading || disposed || !opened)return loading
    controller=new AbortController();const mine=controller
    ui.retry.hidden=true;ui.player.setAttribute('aria-busy','true');notice('Loading tour…')
    const timeout=setTimer(()=>mine.abort(),12000)
    loading=(async()=>{
      try {
        const response=await request(manifestUrl,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:mine.signal,headers:{accept:'application/json'}})
        if(!response.ok || Number(response.headers?.get('content-length'))>65536)throw Error('Tour unavailable')
        const raw=await response.text();if(raw.length>65536)throw Error('Tour too large')
        const value=validateTourManifest(JSON.parse(raw));if(!value)throw Error('Invalid tour')
        if(!opened || disposed || mine.signal.aborted)return
        manifest=value;kind=manifest.kind;state=createTourState();paintedChapter=-1;ui.chapters.replaceChildren();ui.chapterButtons=[]
        manifest.chapters.forEach((chapter,index)=>{const item=element('li'),jump=button(chapter.title,'chapter','pt-chapter');jump.dataset.chapter=chapter.id;jump.setAttribute('aria-label','Chapter '+(index+1)+': '+chapter.title);on(jump,'click',()=>{seek(chapter.start);if(view?.matchMedia?.('(max-width: 650px)').matches)ui.player.scrollIntoView?.({block:'start',behavior:reduced()?'auto':'smooth'})});item.append(jump);ui.chapters.append(item);ui.chapterButtons.push(jump)})
        ui.progress.max=String(manifest.duration);ui.progress.disabled=false
        for(const node of [ui.play,ui.replay,ui.captions,ui.fullscreen])node.disabled=false
        if(kind==='video') {
          if(manifest.captions){const track=element('track');track.kind='captions';track.label='English';track.srclang='en';track.src=manifest.captions;track.default=true;on(track,'load',applyCaptions);ui.video.append(track)}
          ui.video.src=manifest.video
        }
        paint();notice()
      }catch {
        if(opened && !disposed && controller===mine){notice('The tour couldn’t load. Try again.');ui.heading.textContent='Explore COMPASS';ui.retry.hidden=false}
      }finally {
        clearTimer(timeout)
        if(controller===mine){loading=null;ui.player.setAttribute('aria-busy','false')}
      }
    })()
    return loading
  }
  async function open() {
    if(disposed)return
    if(!ui)create()
    const wasClosing=closing!=null
    if(closing!=null){clearTimer(closing);closing=null}
    if(!opened && !wasClosing){focusBefore=doc.activeElement || trigger;bodyOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden'}
    opened=true;trigger.setAttribute('aria-expanded','true');ui.dialog.classList.remove('is-closing')
    if(!ui.dialog.open){if(typeof ui.dialog.showModal==='function')ui.dialog.showModal();else{ui.dialog.setAttribute('open','');ui.dialog.setAttribute('role','dialog')}}
    ui.dialog.getBoundingClientRect()
    ui.dialog.classList.add('is-open');ui.exit.focus({preventScroll:true})
    if(!manifest)await load();else paint()
  }
  function destroy() {
    if(disposed)return
    if(opened)close()
    disposed=true;controller?.abort();stopFrame();if(closing!=null)clearTimer(closing);finishClose()
    listeners.splice(0).forEach(remove=>remove());ui?.dialog.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');trigger.removeAttribute('aria-haspopup')
  }
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id)
  trigger.title='Explore COMPASS without leaving this project.'
  on(trigger,'click',()=>void open())
  return {open,close,destroy,get isOpen(){return opened}}
}
