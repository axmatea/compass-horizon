import { useEffect, useRef, useState } from "react";
import "./pitch-deck.css";

const slides = [
 {chapter:"A CONVERSATION STARTS HERE", title:"Think out loud.", accent:"Find what’s next.", body:"A voice-first thinking partner.", voice:"Hi. I’m Compass. Think out loud. You don’t need the perfect words. Let’s find your next step.", seconds:9},
 {chapter:"01 / A HUMAN MOMENT",title:"A new day.",accent:"A thousand thoughts.",body:"Sometimes, the hardest part is knowing where to begin.",voice:"A new day. A thousand thoughts. Sometimes, the hardest part is knowing where to begin.",seconds:7},
 {chapter:"02 / SPEAK NATURALLY",title:"No perfect prompt.",accent:"Just you.",body:"Speak naturally. Pause. Change your mind.",voice:"No perfect prompt. Just you. Speak naturally. Pause. Change your mind.",seconds:7},
 {chapter:"03 / KEEP THE THREAD",title:"Many thoughts.",accent:"One clearer picture.",body:"A concept designed to keep what matters in view.",voice:"Your ideas, your questions, the people who matter. A clearer picture begins with the thread that connects them.",seconds:8},
 {chapter:"04 / CHANGE DIRECTION",title:"Your first thought",accent:"isn’t your final answer.",body:"Let the goal evolve without losing what matters.",voice:"I think I need to leave. Actually, I want things to change. Your first thought isn’t your final answer.",seconds:8},
 {chapter:"05 / MAKE IT CONCRETE",title:"From thinking",accent:"to one next step.",body:"Small enough to take. Meaningful enough to matter.",voice:"One honest conversation. Ask your cofounder to meet. Small enough to take. Meaningful enough to matter.",seconds:8},
 {chapter:"06 / BACK TO YOUR LIFE",title:"Less noise.",accent:"More room for you.",body:"For your ideas. Your work. Your life.",voice:"Less noise. More room for you. For your ideas. Your work. Your life.",seconds:6},
 {chapter:"COMPASS",title:"A brighter tomorrow",accent:"starts with a conversation.",body:"Find your next step.",voice:"Compass. A brighter tomorrow starts with a conversation.",seconds:7}
];
const backgrounds=["","/assets/film-poster.webp","/assets/hero.webp","","","/assets/film-poster.webp","/assets/conversation.webp",""];
type Props={open:boolean;onClose:()=>void;onFilm:()=>void;onDemo:()=>void};
export default function PitchDeck({open,onClose,onFilm,onDemo}:Props){
 const dialog=useRef<HTMLDialogElement>(null);
 const touch=useRef<number|null>(null);
 const [index,setIndex]=useState(0);
 const [direction,setDirection]=useState(1);
 const [running,setRunning]=useState(false);
 const [voice,setVoice]=useState(false);
 const [speaking,setSpeaking]=useState(false);
 const [supported,setSupported]=useState(false);
 const [notice,setNotice]=useState("");
 const [full,setFull]=useState(false);
 const [clock,setClock]=useState(0);
 const started=useRef(0);
 const duration=slides[index].seconds*1000;
 useEffect(()=>{setSupported("speechSynthesis" in window)},[]);
 useEffect(()=>{
  if(open){setIndex(0);setClock(0);setRunning(false);setVoice(false);setNotice("");dialog.current?.showModal();}
  else{dialog.current?.close();window.speechSynthesis?.cancel();}
 },[open]);
 function go(to:number){setDirection(to>=index?1:-1);setIndex(Math.max(0,Math.min(slides.length-1,to)));setClock(0);started.current=performance.now();}
 function close(){setRunning(false);setVoice(false);window.speechSynthesis?.cancel();if(document.fullscreenElement===dialog.current)void document.exitFullscreen();onClose();}
 function begin(withVoice:boolean){setVoice(withVoice&&supported);setRunning(true);setClock(0);started.current=performance.now();}
 useEffect(()=>{
  if(!open)return;
  const key=(event:KeyboardEvent)=>{
   if((event.target as HTMLElement)?.matches("input,textarea,select"))return;
   if(event.key==="ArrowRight"){event.preventDefault();go(index+1);}
   if(event.key==="ArrowLeft"){event.preventDefault();go(index-1);}
   if(event.key==="Home"){event.preventDefault();go(0);}
   if(event.key==="End"){event.preventDefault();go(slides.length-1);}
   if(event.code==="Space"&&!(event.target as HTMLElement)?.closest("button")){event.preventDefault();setRunning(v=>!v);}
  };
  window.addEventListener("keydown",key);
  return()=>window.removeEventListener("keydown",key);
 },[open,index]);
 useEffect(()=>{
  if(!open||!running)return;
  started.current=performance.now()-clock*duration;
  let frame=0;
  function tick(now:number){
   const progress=Math.min(1,(now-started.current)/duration);setClock(progress);
   if(progress>=1&&!window.speechSynthesis?.speaking){
    if(index===slides.length-1){setRunning(false);return;}
    setDirection(1);setIndex(v=>v+1);setClock(0);return;
   }
   frame=requestAnimationFrame(tick);
  }
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[open,running,index]);
 useEffect(()=>{
  if(!open||!voice||!running||!supported){window.speechSynthesis?.cancel();setSpeaking(false);return;}
  const synth=window.speechSynthesis;
  synth.cancel();
  const line=new SpeechSynthesisUtterance(slides[index].voice);
  line.lang="en-US";line.rate=.94;line.pitch=1;
  const voices=synth.getVoices();
  line.voice=voices.find(v=>/Samantha|Google US English/.test(v.name))??voices.find(v=>v.lang==="en-US")??null;
  line.onstart=()=>setSpeaking(true);line.onend=()=>setSpeaking(false);
  line.onerror=(e)=>{setSpeaking(false);if(e.error!=="interrupted"&&e.error!=="canceled")setNotice("Browser voice unavailable. The presentation continues silently.");};
  synth.speak(line);
  return()=>{line.onstart=null;line.onend=null;line.onerror=null;synth.cancel();};
 },[open,index,voice,running,supported]);
 useEffect(()=>{const listener=()=>setFull(document.fullscreenElement===dialog.current);document.addEventListener("fullscreenchange",listener);return()=>document.removeEventListener("fullscreenchange",listener)},[]);
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await dialog.current?.requestFullscreen();}catch{setNotice("Fullscreen is unavailable here. The presentation still fills this window.");}}
 return <dialog ref={dialog} className="cp-deck" aria-label="COMPASS cinematic presentation" onCancel={e=>{e.preventDefault();close();}} onClose={()=>{if(open)close();}}>
  <div className="cp-stage" data-slide={index} data-direction={direction} onTouchStart={e=>{touch.current=e.touches[0].clientX;}} onTouchEnd={e=>{if(touch.current!==null){const delta=e.changedTouches[0].clientX-touch.current;if(Math.abs(delta)>60)go(index+(delta<0?1:-1));touch.current=null;}}}>
   <div className="cp-backgrounds" aria-hidden="true">{backgrounds.map((src,i)=>src?<img key={i} src={src} alt="" className={i===index?"is-current":""}/>:null)}</div>
   <div className="cp-vignette" aria-hidden="true"/>
   <header className="cp-header"><span className="cp-wordmark">COMPASS</span><span className="cp-concept">PRODUCT CONCEPT</span><div><button onClick={fullscreen} aria-label={full?"Exit fullscreen":"Enter fullscreen"}>{full?"↙":"↗"}</button><button onClick={close} aria-label="Close presentation">×</button></div></header>
   <div className={"cp-orb-position "+([0,7].includes(index)?"cp-orb-hero":"cp-orb-corner")} aria-hidden="true">
    <div className={"cp-orb "+(speaking?"is-speaking":"")}><div className="cp-orb-core"/><div className="cp-orb-ring"/><div className="cp-orb-ring cp-orb-ring-two"/><div className="cp-orb-glint"/></div>
    <div className={"cp-wave "+(speaking?"is-speaking":"")}>{Array.from({length:35},(_,i)=><i key={i} style={{"--i":i,"--height":8+Math.round(Math.sin(i*1.73)**2*37)} as React.CSSProperties}/>)}</div>
   </div>
   <div className="cp-slides">{slides.map((slide,i)=><section key={i} className={"cp-slide cp-slide-"+i+(i===index?" is-active":"")} aria-hidden={i!==index} inert={i!==index}>
    <div className="cp-slide-copy">
     <p className="cp-chapter cp-reveal">{slide.chapter}</p>
     <h2 className="cp-reveal">{slide.title}<br/><span>{slide.accent}</span></h2>
     <p className="cp-body cp-reveal">{slide.body}</p>
     {i===0&&<div className="cp-start cp-reveal"><button onClick={()=>begin(true)} disabled={running}>{running?(speaking?"COMPASS is speaking…":"Playing…"):supported?"Start with voice ↗":"Start presentation ↗"}</button>{!running&&<button className="cp-text-button" onClick={()=>begin(false)}>Start silently</button>}<small>Scripted introduction · browser voice</small></div>}
     {i===2&&<p className="cp-quote cp-reveal">“Hey COMPASS…<br/>I’m not sure where to start.”</p>}
     {i===7&&<div className="cp-end-actions cp-reveal"><button onClick={()=>{close();onDemo();}}>Try the concept ↗</button><button className="cp-text-button" onClick={()=>{close();onFilm();}}>Watch the film ▶</button><small>Guided demo. Scripted responses. No live AI connected.</small></div>}
    </div>
    {i===3&&<div className="cp-thread cp-reveal"><div className="cp-thoughts">{["Ideas","Plans","Questions","What matters"].map((t,n)=><div key={t} style={{"--order":n} as React.CSSProperties}><span>0{n+1}</span>{t}<i/></div>)}</div><div className="cp-thread-line"/><div className="cp-thread-result"><span>THE THREAD</span><strong>The work still matters.</strong><p>The partnership matters, too.</p></div></div>}
    {i===4&&<div className="cp-pivot cp-reveal"><p className="cp-before">“I need to leave.”</p><span className="cp-pivot-line"/><p className="cp-after">“I want things<br/>to change.”</p><small>A different thought. A different next step.</small></div>}
    {i===5&&<div className="cp-action cp-reveal"><span className="cp-action-label"><i>✓</i> YOUR NEXT STEP</span><h3>Have the<br/>conversation.</h3><p>“Can we make time tomorrow?<br/>I want us to share the weight.”</p><div><span>Tomorrow · 20 minutes</span><span>↗</span></div><small>Illustrative action card</small></div>}
    {i===6&&<div className="cp-life-labels cp-reveal"><span>Your ideas.</span><span>Your work.</span><span>Your life.</span></div>}
   </section>)}</div>
   <footer className="cp-footer">
    <div className="cp-timeline" aria-label="Choose a slide">{slides.map((s,i)=><button key={s.chapter} aria-label={"Slide "+(i+1)+": "+s.title} aria-current={i===index?"step":undefined} onClick={()=>go(i)}><span style={{transform:"scaleX("+(i<index?1:i===index?(running?Math.max(.04,clock):1):0)+")"}}/></button>)}</div>
    <div className="cp-controls"><span className="cp-slide-counter">0{index+1}<i>/</i>0{slides.length}</span><p role="status">{notice||(speaking?"COMPASS · Speaking":running?"COMPASS · Playing":"COMPASS · Ready")}</p><div><button disabled={!supported} aria-pressed={voice} aria-label={voice?"Mute narration":"Enable narration"} onClick={()=>setVoice(v=>!v)}>{voice?"Voice on":"Voice off"}</button><button aria-label={running?"Pause presentation":"Play presentation"} onClick={()=>setRunning(v=>!v)}>{running?"Ⅱ":"▶"}</button><button aria-label="Previous slide" disabled={index===0} onClick={()=>go(index-1)}>←</button><button aria-label="Next slide" disabled={index===slides.length-1} onClick={()=>go(index+1)}>→</button></div></div>
   </footer>
  </div>
 </dialog>;
}
