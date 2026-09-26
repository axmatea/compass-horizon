import type { ScenePerson } from './types.ts';

export type Person = ScenePerson & { initials: string; schedule: string; relationship: string; context: string; nextAction: string };
export type OfficeTask = { id: string; title: string; owner: string; day: number; time: string; status: 'todo' | 'doing' | 'done'; dependsOn: string | null; sourceId: string };
export type Source = { id: string; title: string; author: string; time: string; content: string; kind: 'Brief' | 'Provider note' | 'Team update' };
export type Phase = 'calm' | 'changed' | 'proposed' | 'approved';
export type OfficeState = { phase: Phase; tasks: OfficeTask[]; sources: Source[]; meetingPlanned: boolean; notice: string; decision: string | null; nextNote: number };

export const PEOPLE: Person[] = [
 {id:'maya',name:'Maya Chen',initials:'MC',role:'Project lead',color:'#98816b',objective:'Open Harbor studio without losing the reason behind a decision.',schedule:'Friday 15:00 · Client preview',relationship:'Harbor studio · project owner',context:'The Friday client preview is fixed. Any dependency change needs her confirmation.',nextAction:'Review the launch plan.'},
 {id:'noa',name:'Noa Park',initials:'NP',role:'Operations',color:'#78916b',objective:'Get the display modules to the studio before installation.',schedule:'Wednesday 09:00 · Delivery handover',relationship:'Oak & Co. · display supplier',context:'Owns delivery timing and the handover to Leo.',nextAction:'Confirm the supplier arrival window.'},
 {id:'leo',name:'Leo Martin',initials:'LM',role:'Build & systems',color:'#bc9466',objective:'Install and validate the display before the client preview.',schedule:'Wednesday 10:00 · Installation',relationship:'Oak & Co. · technical handover',context:'Installation depends on Noa receiving the modules. Validation must precede the preview.',nextAction:'Prepare the installation checklist.'},
 {id:'esra',name:'Esra Yilmaz',initials:'EY',role:'Experience design',color:'#aa8275',objective:'Make the visitor journey clear and welcoming.',schedule:'Tuesday 11:00 · Design review',relationship:'Harbor studio · visitor team',context:'The visitor flow and signage are approved independently of the display delivery.',nextAction:'Finish the signage handoff.'},
 {id:'ravi',name:'Ravi Shah',initials:'RS',role:'Brand & content',color:'#88958f',objective:'Give every touchpoint one consistent voice.',schedule:'Tuesday 14:00 · Content handoff',relationship:'Press partners · copy review',context:'The launch copy does not depend on the display installation.',nextAction:'Proof the welcome copy.'},
 {id:'sam',name:'Sam Rivera',initials:'SR',role:'Client partner',color:'#aba071',objective:'Keep the client prepared for Friday’s preview.',schedule:'Friday 15:00 · Client preview',relationship:'Harbor studio · client team',context:'The client preview remains Friday at 15:00. Only a confirmed change to that slot needs escalation.',nextAction:'Prepare the client agenda.'},
];
export const DAYS = [{label:'Mon',date:'28 Sep'}, {label:'Tue',date:'29 Sep'}, {label:'Wed',date:'30 Sep'}, {label:'Thu',date:'01 Oct'}, {label:'Fri',date:'02 Oct'}];
export const AFFECTED_IDS = ['noa','leo','maya'];
export const MEETING_IDS = ['noa','leo'];
export const DELAY_SOURCE: Source = {id:'supplier-delay',title:'Delivery window changed',author:'Oak & Co. · sample provider message',time:'Mon 28 Sep · 10:42',kind:'Provider note',content:'The display modules will arrive Thursday, October 1 at 09:00, rather than Wednesday, September 30 at 09:00. Noa, please confirm the handover with Leo. The installation takes one day; validation can happen the following morning. This is a fictional provider message for the interactive demo.'};

export function createOffice(): OfficeState {
 return {phase:'calm',meetingPlanned:false,decision:null,nextNote:1,notice:'Six fictional seats. All demo changes stay in this browser session.',sources:[
  {id:'brief',title:'Harbor studio opening brief',author:'Maya Chen',time:'Mon 28 Sep · 09:00',kind:'Brief',content:'Goal: prepare Harbor studio for the client preview on Friday, October 2 at 15:00. Owner: Maya. Display modules must be delivered before installation; installation and validation must finish before the preview. Noa owns the supplier handover; Leo owns installation and validation. Signage, copy and the client agenda can proceed independently. This team and project are fictional.'},
  {id:'delivery-original',title:'Original delivery agreement',author:'Noa Park · recorded supplier note',time:'Mon 28 Sep · 09:15',kind:'Provider note',content:'Oak & Co. initially confirmed Wednesday, September 30 at 09:00. Noa will receive the modules. Leo will install them on Wednesday and validate on Thursday at 09:00. The original note is retained even if the plan changes.'},
 ],tasks:[
  {id:'delivery',title:'Receive display modules',owner:'noa',day:2,time:'09:00',status:'todo',dependsOn:null,sourceId:'delivery-original'},
  {id:'install',title:'Install the display',owner:'leo',day:2,time:'10:00',status:'todo',dependsOn:'delivery',sourceId:'brief'},
  {id:'validate',title:'Validate the experience',owner:'leo',day:3,time:'09:00',status:'todo',dependsOn:'install',sourceId:'brief'},
  {id:'preview',title:'Client preview',owner:'maya',day:4,time:'15:00',status:'todo',dependsOn:'validate',sourceId:'brief'},
  {id:'signage',title:'Visitor signage handoff',owner:'esra',day:1,time:'11:00',status:'doing',dependsOn:null,sourceId:'brief'},
  {id:'copy',title:'Welcome copy handoff',owner:'ravi',day:1,time:'14:00',status:'done',dependsOn:null,sourceId:'brief'},
  {id:'agenda',title:'Prepare the client agenda',owner:'sam',day:3,time:'14:00',status:'doing',dependsOn:null,sourceId:'brief'},
 ]};
}
export function projectedTask(task: OfficeTask, phase: Phase): OfficeTask {
 if(phase !== 'proposed')return task;
 return ['delivery','install','validate'].includes(task.id) ? {...task,day:task.day+1} : task;
}
export type OfficeAction = {type:'delay'} | {type:'propose'} | {type:'approve'} | {type:'meeting'} | {type:'reset'} | {type:'task';id:string;status:OfficeTask['status']} | {type:'note';text:string};
export function officeReducer(state:OfficeState, action:OfficeAction): OfficeState {
 switch(action.type){
  case 'reset':return createOffice();
  case 'delay':return state.phase!=='calm'?state:{...state,phase:'changed',sources:[...state.sources,{...DELAY_SOURCE}],notice:'A fictional provider update arrived. Noa, Leo and Maya are affected. The plan has not changed.'};
  case 'propose':return state.phase!=='changed'?state:{...state,phase:'proposed',notice:'Previewing a scripted revision. Nothing is applied until Maya confirms.'};
  case 'approve':return state.phase!=='proposed'?state:{...state,phase:'approved',tasks:state.tasks.map(task=>({...projectedTask(task,'proposed'),sourceId:['delivery','install','validate'].includes(task.id)?'supplier-delay':task.sourceId})),decision:'Maya confirmed: receive and install Thursday; validate Friday at 09:00. Keep the client preview Friday at 15:00.',notice:'The local plan is updated. Original notes remain in source history. No notifications were sent.'};
  case 'meeting':return state.phase==='calm'||state.meetingPlanned?state:{...state,meetingPlanned:true,notice:'A ten-minute Noa + Leo handover was added to this demo only. No invitations were sent.'};
  case 'task':return !['todo','doing','done'].includes(action.status)?state:{...state,tasks:state.tasks.map(t=>t.id===action.id?{...t,status:action.status}:t),notice:'Task status updated in this local demo.'};
  case 'note':{const text=action.text.trim();if(!text||text.length>2000)return state;return {...state,nextNote:state.nextNote+1,sources:[...state.sources,{id:`local-note-${state.nextNote}`,title:`Your context note ${state.nextNote}`,author:'You · demo visitor',time:'This browser session',kind:'Team update',content:text}],notice:'Your note is kept verbatim in local source history. No AI interpreted it or changed the plan.'};}
 }
}
export function memoryPacket(state:OfficeState){return [
 {label:'Goal',value:'Open Harbor studio · Friday 15:00',source:'brief'},
 {label:'Owner',value:'Maya Chen · project lead',source:'brief'},
 {label:'Constraint',value:state.phase==='calm'?'Install after delivery. Validate before the preview.':'Delivery is Thursday 09:00. Validate before Friday 15:00.',source:state.phase==='calm'?'brief':'supplier-delay'},
 {label:'Decision',value:state.decision??'No revision approved. The original plan remains in place.',source:state.decision?'supplier-delay':'brief'},
 {label:'Next action',value:state.phase==='calm'?'Noa confirms the original delivery window.':state.phase==='approved'?'Noa and Leo coordinate the Thursday handover.':'Maya reviews the affected delivery, installation and validation tasks.',source:state.phase==='calm'?'delivery-original':'supplier-delay'},
 ];}
