'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import OfficeScene from './scene/OfficeScene';
import Narrative from './story/Narrative';
import { OfficeBrand, Icon } from './components';
import { AFFECTED_IDS, DAYS, MEETING_IDS, PEOPLE, createOffice, memoryPacket, officeReducer, projectedTask } from './model';
import type { OfficeState, OfficeTask, Source } from './model';
import './tokens.css';
import './app.css';
import './mobile.css';

type View = 'office' | 'plan' | 'memory';
type Panel = 'overview' | 'person' | 'meeting';
const viewNames: Record<View,string> = {office:'Office',plan:'Shared plan',memory:'Shared memory'};
const STATUS = {todo:'To do',doing:'In progress',done:'Complete'};

function Plan({state,onPerson,onSource}:{state:OfficeState;onPerson:(id:string)=>void;onSource:(id:string)=>void}){
 const preview=state.phase==='proposed';
 return <section className="of-plan" aria-labelledby="plan-title"><header className="of-section-heading"><div><p className="of-kicker">On the central table</p><h2 id="plan-title">One week. One shared plan.</h2></div><span className={`of-status-tag ${preview?'attention':''}`}>{preview?'Proposed revision':state.phase==='approved'?'Owner-confirmed revision':'Original plan'}</span></header>
  <div className="of-timeline-head"><span>Responsibility</span>{DAYS.map(day=><span key={day.label}>{day.label}<small>{day.date}</small></span>)}</div>
  <div className="of-timeline-body">{state.tasks.map(task=>{const proposed=projectedTask(task,state.phase);const owner=PEOPLE.find(p=>p.id===task.owner)!;const changed=state.phase!=='calm'&&['delivery','install','validate'].includes(task.id);return <div className={`of-timeline-row ${changed?'attention':''}`} key={task.id}>
   <button className="of-row-person" onClick={()=>onPerson(owner.id)}><span className="of-avatar" style={{'--seat-color':owner.color} as CSSProperties}>{owner.initials}</span><span>{owner.name.split(' ')[0]}<small>{task.dependsOn?'Depends on '+state.tasks.find(t=>t.id===task.dependsOn)?.title:'Independent step'}</small></span></button>
   <div className="of-lanes" aria-hidden="true">{DAYS.map(day=><i key={day.label}/>)}</div>
   <button className={`of-task-bar ${task.status==='done'?'complete':''}`} style={{gridColumn:proposed.day+2} as CSSProperties} onClick={()=>onSource(task.sourceId)} aria-label={`${task.title}, ${DAYS[proposed.day].label} ${proposed.time}. Open source`}><span>{task.title}</span><small>{preview&&changed&&<del>{DAYS[task.day].label} · </del>}{DAYS[proposed.day].label} {proposed.time}</small></button>
  </div>;})}</div>
  <footer className="of-plan-caption"><span className="of-dependency-key"/> Delivery → installation → validation → client preview. The source stays attached to each demo step.</footer>
 </section>;
}

export default function App(){
 const [state,dispatch]=useReducer(officeReducer,undefined,createOffice);
 const [view,setView]=useState<View>('office');
 const [panel,setPanel]=useState<Panel>('overview');
 const [personId,setPersonId]=useState('maya');
 const [source,setSource]=useState<Source|null>(null);
 const [note,setNote]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 const workbench=useRef<HTMLElement>(null);
 const changed=state.phase!=='calm';
 const approved=state.phase==='approved';
 const person=PEOPLE.find(p=>p.id===personId)!;
 const packet=memoryPacket(state);
 const sources=state.sources;

 useEffect(()=>{if(source&&!dialog.current?.open)dialog.current?.showModal();if(!source&&dialog.current?.open)dialog.current.close();},[source]);
 function showSource(id:string){setSource(sources.find(s=>s.id===id)??null);}
 function showPerson(id:string){setPersonId(id);setPanel('person');}
 function showView(next:View){setView(next);setPanel('overview');}
 function enterOffice(next:View){showView(next);workbench.current?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
 function reset(){dispatch({type:'reset'});setView('office');setPanel('overview');setSource(null);setNote('');}
 function action(){if(state.phase==='calm')dispatch({type:'delay'});else if(state.phase==='changed'){dispatch({type:'propose'});setView('plan');}else if(state.phase==='proposed')dispatch({type:'approve'});else{setView('memory');setPanel('overview');}}
 const actionLabel={calm:'Introduce a supplier delay',changed:'Review the revised plan',proposed:'Approve as Maya',approved:'Trace this decision'}[state.phase];

 return <div className="office-universe of-app">
  <a className="of-skip" href="#office-content">Skip to office</a>
  <header className="of-header"><OfficeBrand/><span className="of-header-caption">A shared place to think & work.</span><nav aria-label="Product links"><a href="/">Home</a><a href="/presentation">Presentation</a><a href="/studio/tour">Studio guide <span aria-hidden="true">↗</span></a></nav><span className="of-header-avatar" aria-label="Maya, fictional demo owner">MC</span></header>
  <main id="office-content">
   <section className="of-workbench" ref={workbench} aria-label="Harbor studio virtual office">
    <div className="of-room-heading"><div><p className="of-kicker">FIELDWORK / HARBOR STUDIO</p><h1>Different minds.<br className="of-mobile-break"/> <em>One shared place.</em></h1></div><div className="of-room-date"><span className="of-kicker">The week ahead</span><strong>28 Sep - 02 Oct</strong><small>Fictional project · 2026</small></div></div>
    <div className="of-toolbar"><nav aria-label="Office views">{(['office','plan','memory'] as View[]).map(item=><button key={item} aria-current={view===item?'page':undefined} onClick={()=>showView(item)}><Icon name={item}/>{viewNames[item]}</button>)}</nav><span className="of-demo-label">Interactive concept · local only</span><button className="of-reset" onClick={reset} aria-label="Reset office demo">Reset ↺</button></div>
    <div className="of-workspace-grid">
     <div className="of-space">
      <div className={`of-scene-wrap ${view!=='office'?'compact':''}`}>
       <OfficeScene people={PEOPLE} selectedId={panel==='person'?personId:null} affectedIds={changed?AFFECTED_IDS:[]} layer={view==='memory'?'memory':'office'} meetingIds={panel==='meeting'&&changed?MEETING_IDS:[]} onSelectPerson={showPerson} onSelectPlan={()=>showView('plan')} onSelectMemory={()=>showView('memory')} compact={view!=='office'}/>
      </div>
      {view==='office'&&<div className="of-room-caption"><div><span className="of-compass-tick"/><p>Everyone has their own work.<br/><strong>The context belongs to the team.</strong></p></div><button className="of-text-button" onClick={()=>showView('memory')}>See what connects them <Icon name="arrow"/></button></div>}
      {view==='plan'&&<Plan state={state} onPerson={showPerson} onSource={showSource}/>}
      {view==='memory'&&<section className="of-memory" aria-labelledby="memory-title"><header className="of-section-heading"><div><p className="of-kicker">The foundation beneath the work</p><h2 id="memory-title">A little context.<br/><em>With its whole history.</em></h2></div><span className="of-status-tag">Curated demo packet</span></header><p className="of-memory-note">An inspectable summary, not a replacement for the source. No live compression or learning is running.</p><ol className="of-packet">{packet.map((item,i)=><li key={item.label}><span className="of-packet-number">0{i+1}</span><div><span className="of-kicker">{item.label}</span><p>{item.value}</p></div><button className="of-source-button" onClick={()=>showSource(item.source)} aria-label={`Read source for ${item.label}`}><Icon name="source"/><span>Source</span></button></li>)}</ol><div className="of-archive"><h3>Source history <span>{sources.length}</span></h3><p>Original words stay intact. New evidence adds a layer.</p>{sources.map(item=><button key={item.id} onClick={()=>setSource(item)}><Icon name="source"/><span><strong>{item.title}</strong><small>{item.author} · {item.time}</small></span><Icon name="arrow"/></button>)}</div></section>}
     </div>
     <aside className="of-inspector" aria-label="Office inspector">
      {panel!=='overview'&&<button className="of-text-button of-back" onClick={()=>setPanel('overview')}>← Back to the shared view</button>}
      {panel==='overview'&&<>
       <div className="of-inspector-title"><p className="of-kicker">At the center</p><h2>Harbor studio,<br/><em>ready for Friday.</em></h2><p>One opening. Six people.<br/>A plan that keeps its context.</p></div>
       <div className="of-deadline"><Icon name="plan"/><div><strong>Client preview</strong><span>Fri 02 Oct · 15:00</span></div><span className="of-status-tag">Fixed</span></div>
       <section className={`of-change-card ${changed?'attention':''}`} aria-labelledby="change-title"><span className="of-kicker">{state.phase==='calm'?'Try one meaningful change':approved?'Change, with a reason':'Attention / dependency changed'}</span><h3 id="change-title">{state.phase==='calm'?'What if delivery slips a day?':approved?'A new plan. The same goal.':'The modules arrive Thursday.'}</h3><p>{state.phase==='calm'?'Watch the office route the update to the people who need it. This is a scripted scenario.':approved?'Installation moves to Thursday. Validation moves to Friday morning. The client preview stays at 15:00.':'Noa’s delivery affects Leo’s installation and Maya’s launch plan. Everyone else keeps their schedule.'}</p>
        {changed&&<><button className="of-text-button" onClick={()=>showSource('supplier-delay')}>Read the provider note <Icon name="source"/></button><div className="of-affected" aria-label="Affected people">{AFFECTED_IDS.map(id=>{const p=PEOPLE.find(x=>x.id===id)!;return <button key={id} onClick={()=>showPerson(id)}><span className="of-avatar" style={{'--seat-color':p.color} as CSSProperties}>{p.initials}</span><span>{p.name.split(' ')[0]}</span></button>;})}<span>Only affected<br/>roles highlighted</span></div></>}
        <button className={`of-button ${changed&&!approved?'of-button-amber':'of-button-primary'}`} onClick={action}>{actionLabel}<Icon name="arrow"/></button>
        <small>{state.phase==='proposed'?'This applies only to the local demo. Nothing is sent.':approved?'Confirmed in this browser session. Reset restores the original.':'No notifications, bookings or model calls.'}</small>
       </section>
       <button className="of-meeting-entry" onClick={()=>setPanel('meeting')}><Icon name="meeting"/><span><strong>Meet only when it matters.</strong><small>{changed?'Noa + Leo · a ten-minute handover':'No meeting needed right now.'}</small></span><Icon name="arrow"/></button>
       <div className="of-owner-note"><span className="of-avatar" style={{'--seat-color':PEOPLE[0].color} as CSSProperties}>MC</span><p><strong>People own the decisions.</strong><br/>The office makes their context visible.</p></div>
      </>}
      {panel==='person'&&<>
       <div className="of-person-heading"><span className="of-avatar large" style={{'--seat-color':person.color} as CSSProperties}>{person.initials}</span><p className="of-kicker">A seat, not a presence indicator</p><h2>{person.name}</h2><p>{person.role}</p></div>
       <section className="of-person-section"><h3>Current objective</h3><p>{person.objective}</p></section>
       <section className="of-person-section"><h3>On {person.name.split(' ')[0]}’s desk</h3>{state.tasks.filter(t=>t.owner===personId).map(task=><div className="of-person-task" key={task.id}><button onClick={()=>showSource(task.sourceId)}>{task.title}<small>{DAYS[task.day].label} · {task.time}</small></button><label><span className="of-sr-only">Status for {task.title}</span><select value={task.status} onChange={e=>dispatch({type:'task',id:task.id,status:e.target.value as OfficeTask['status']})}>{Object.entries(STATUS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>)}</section>
       <section className="of-person-section"><h3>Relevant context</h3><p>{changed&&AFFECTED_IDS.includes(personId)?approved?'The revised plan is confirmed. Delivery and installation are Thursday; validation is Friday morning.':'The provider changed delivery to Thursday. The original plan is awaiting review.':person.context}</p><button className="of-text-button" onClick={()=>showSource(changed&&AFFECTED_IDS.includes(personId)?'supplier-delay':'brief')}>Inspect the original source <Icon name="source"/></button></section>
       <section className="of-person-section"><h3>Relationships</h3><p>{person.relationship}</p></section>
       <section className="of-person-section"><h3>Coordination</h3><p>{changed&&MEETING_IDS.includes(personId)?'Proposed: Thu 09:30, ten-minute delivery handover.':'No additional coordination proposed.'}</p>{changed&&MEETING_IDS.includes(personId)&&<button className="of-text-button" onClick={()=>setPanel('meeting')}>Why these two people? <Icon name="arrow"/></button>}</section>
       <div className="of-next-action"><p className="of-kicker">Next action</p><p>{changed&&AFFECTED_IDS.includes(personId)?personId==='maya'?(approved?'Keep the Friday preview as agreed.':'Review the proposed plan.'):'Coordinate the revised supplier handover.':person.nextAction}</p></div>
      </>}
      {panel==='meeting'&&<section className="of-meeting"><p className="of-kicker">Necessary coordination</p><h2>{changed?<>Two people.<br/><em>Ten minutes.</em></>:<>Keep the focus.<br/><em>No meeting yet.</em></>}</h2><p>{changed?'Noa owns the supplier handover. Leo owns installation. They share one unresolved dependency.':'The original plan has no new dependency to resolve. A meeting is not the default.'}</p>{changed&&<><div className="of-meeting-people">{MEETING_IDS.map(id=>{const p=PEOPLE.find(x=>x.id===id)!;return <button key={id} onClick={()=>showPerson(id)}><span className="of-avatar large" style={{'--seat-color':p.color} as CSSProperties}>{p.initials}</span><strong>{p.name.split(' ')[0]}</strong><small>{p.role}</small></button>;})}</div><dl><dt>When</dt><dd>Thu 01 Oct · 09:30–09:40</dd><dt>Resolve</dt><dd>Confirm delivery handover and installation start.</dd><dt>Why not everyone?</dt><dd>Esra, Ravi and Sam have no changed tasks. Maya approves the plan without joining this handover.</dd></dl><button className="of-button of-button-primary" disabled={state.meetingPlanned} onClick={()=>dispatch({type:'meeting'})}>{state.meetingPlanned?'Added to local plan':'Add demo coordination'}</button><p className="of-fine">Suggested fixture slot, not a checked calendar. Figures gathering here preview the proposal; they do not represent attendance. No invite is sent.</p></>}</section>}
     </aside>
    </div>
    <form className="of-context-input" onSubmit={e=>{e.preventDefault();if(note.trim()){dispatch({type:'note',text:note});setNote('');setView('memory');setPanel('overview');}}}><Icon name="source"/><label htmlFor="context-note" className="of-sr-only">Add a context note</label><input id="context-note" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} placeholder="Add something the team should remember…"/><button className="of-button" disabled={!note.trim()} type="submit">Keep this context <Icon name="arrow"/></button><small>Local source note. No AI interpretation.</small></form>
    <div role="status" className="of-status" aria-live="polite" aria-atomic="true">{state.notice}</div>
   </section>
   <Narrative onEnterOffice={()=>enterOffice('office')} onExploreMemory={()=>enterOffice('memory')}/>
  </main>
  <footer className="of-app-footer"><OfficeBrand/><p>Designed around people. Grounded in shared context.</p><span>Concept demo · resettable synthetic data · AI not connected</span></footer>
  <dialog ref={dialog} className="of-source-dialog" aria-labelledby="source-heading" onClose={()=>setSource(null)}><div className="of-dialog-top"><span className="of-kicker">Source history / Original words</span><button className="of-button" autoFocus onClick={()=>dialog.current?.close()} aria-label="Close source"><Icon name="close"/>Close</button></div><h2 id="source-heading">{source?.title}</h2><p className="of-source-byline">{source?.author} · {source?.time}</p><div className="of-source-content">{source?.content}</div><p className="of-fine">Context is evidence, not permission to act. Public demo content stays in this browser session.</p></dialog>
 </div>;
}
