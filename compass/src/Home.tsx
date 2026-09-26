import { useEffect, useRef, useState } from "react";
import CompassDemo from "./components/CompassDemo";
import PitchDeck from "./components/PitchDeck";

const FILM = "/media/compass-film-nyc.mp4";
function Mark(){return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 3 26 27 16 21 6 27 16 3Z" stroke="currentColor" strokeWidth="1.5"/><path d="M16 3v18" stroke="currentColor" strokeWidth="1.5"/></svg>}
function Arrow(){return <span aria-hidden="true">↗</span>}
export default function Home(){
 const film=useRef<HTMLVideoElement>(null);
 const [failed,setFailed]=useState(false);
 const [presenting,setPresenting]=useState(false);
 const [playing,setPlaying]=useState(false);
 function watch(){document.getElementById("film")?.scrollIntoView({behavior:"smooth"});void film.current?.play().catch(()=>{});}
 function openPresentation(){film.current?.pause();setPresenting(true);}
 useEffect(()=>{if(window.location.hash==="#present")setPresenting(true);},[]);
 return <div className="compass-site">
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="site-header"><a className="brand" href="#" aria-label="COMPASS home"><Mark/><span>COMPASS</span></a>
   <nav aria-label="Main navigation"><a href="#film">The film</a><a href="#demo">Try the concept</a><a href="/original">Original office</a><a href="/">Current site</a></nav>
   <button className="present-link" onClick={openPresentation}>Present <Arrow/></button>
  </header>
  <main id="main">
   <section className="hero">
    <div className="hero-copy"><p className="kicker">A VOICE-FIRST THINKING PARTNER</p><h1>Room to think.<br/><span>A way forward.</span></h1><p className="hero-intro">Speak naturally. Change your mind.<br/>Find a clear next step.</p>
     <div className="hero-actions"><a className="hero-try" href="#demo">Try COMPASS <Arrow/></a><button className="hero-watch" onClick={watch}><span className="play-disc">▶</span> Watch the 60-second film</button></div>
     <p className="concept-note">An interactive product concept.</p>
    </div>
    <div className="hero-image"><img src="/assets/hero.webp" alt="A man on a quiet morning walk, listening and thinking." width="1200" height="800" fetchPriority="high"/><div className="image-caption"><span>A little space.</span><span>A different perspective.</span></div></div>
   </section>
   <section id="film" className="film-section">
    <div className="section-topline"><span>01 / THE FILM</span><span>60 SEC · SOUND ON</span></div>
    <div className="film-heading"><h2>Your first thought isn't<br/>always the whole story.</h2><p>A young woman thinks she needs to turn a project down.<br/>A conversation helps her find the terms that would make it work.</p></div>
    <div className="film-player" data-playing={playing}>
     <video ref={film} src={FILM} poster="/assets/film-poster-nyc.webp" controls playsInline preload="metadata" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setFailed(true)} aria-label="COMPASS: Think out loud. Move forward. A 60-second product concept film">
      <track kind="captions" src="/compass-en.vtt" srcLang="en" label="English"/>
     </video>
     {failed&&<p className="media-error">The film could not load here. <a href={FILM} target="_blank" rel="noreferrer">Open the film directly</a>.</p>}
    </div>
    <div className="film-bottom"><p>Concept demonstration. AI-generated people and scenes illustrate an intended experience. The draft is not sent.</p><a href={FILM} target="_blank" rel="noreferrer">Open film <Arrow/></a></div>
    <details className="film-transcript"><summary>Read the conversation</summary><div><p><b>You:</b> I think I need to turn this project down.</p><p><b>COMPASS:</b> What makes it a no?</p><p><b>You:</b> The deadline… Actually, no. It's doing the work before I get paid.</p><p><b>COMPASS:</b> Then would an upfront payment change your decision?</p><p><b>You:</b> Yes. Help me ask for that.</p><p><b>Draft · Not sent:</b> I'd be happy to take this on. Could we agree on an upfront payment before work begins?</p></div></details>
   </section>
   <section id="demo" className="demo-section"><div className="demo-intro"><p className="kicker">02 / TRY THE CONCEPT</p><h2>Start anywhere.<br/>See where it takes you.</h2><p>Try a thought, change direction, and make the next step your own.</p></div><CompassDemo/></section>
   <section id="idea" className="idea-section"><div className="idea-image"><img src="/assets/conversation.webp" alt="Two business partners begin an honest conversation over coffee." loading="lazy" width="1344" height="752"/><p>The next step is still yours.</p></div><div className="idea-copy"><p className="kicker">03 / THE IDEA</p><h2>A little less noise.<br/>A little more clarity.</h2><div className="principle"><span>01</span><div><h3>Say it before it's polished.</h3><p>The idea is a conversation you can begin before you know exactly what you mean.</p></div></div><div className="principle"><span>02</span><div><h3>Let the thought change.</h3><p>A new direction shouldn't erase the people, values and constraints that still matter.</p></div></div><div className="principle"><span>03</span><div><h3>Leave with something small.</h3><p>One conversation. One experiment. One next action you can actually take.</p></div></div></div></section>
   <section id="status" className="status-section"><div><p className="kicker">BUILT TO BE EXPERIENCED. CLEAR ABOUT WHAT'S NEXT.</p><h2>A concept today.<br/>A direction worth exploring.</h2></div><div className="status-table"><div><span className="status-tag working">IN THIS DEMO</span><p>Three guided story paths, interactive context changes, browser voice input, optional read-aloud, editable and downloadable action cards.</p></div><div><span className="status-tag">THE PRODUCT VISION</span><p>Open-ended AI conversation, context across sessions, interruption handling and connected actions. These are not implemented here.</p></div></div></section>
   <section className="closing-section"><Mark/><h2>Find your next step.</h2><a href="#demo" className="closing-link">Think out loud with the concept <span aria-hidden="true">→</span></a></section>
  </main>
  <footer className="site-footer"><span>COMPASS <small>Product concept</small></span><div><button onClick={openPresentation}>Presentation mode</button><a href="/pitch-notes.txt" download>Pitch notes</a><a href={FILM} target="_blank" rel="noreferrer">Film download</a></div><p>No account. No COMPASS AI backend connected.</p></footer>
  <PitchDeck open={presenting} onClose={()=>setPresenting(false)} onFilm={watch} onDemo={()=>document.getElementById("demo")?.scrollIntoView({behavior:"smooth"})}/>
 </div>
}
