import { useId } from 'react';
import type { ComponentProps, CSSProperties } from 'react';
import { Avatar, TeamTable } from './TeamTable';

export default function WorkspaceScene({ snapshot, onMember, onTask, onMaterials, demo }: ComponentProps<typeof TeamTable>) {
  const id = useId().replace(/:/g, '');
  const tasks = [...snapshot.tasks.filter(t => t.status === 'doing'), ...snapshot.tasks.filter(t => t.status === 'todo'), ...snapshot.tasks.filter(t => t.status === 'done')].slice(0, 3);
  return <section className="ws-scene" aria-label="Interactive team table">
    <header className="ws-scene-heading"><div><span className="ws-kicker">YOUR PROJECT ROOM</span><h2>{snapshot.workspace.name}</h2></div><span className="ws-room-label">{snapshot.members.length} members <i /> Shared context</span></header>
    <div className="ws-room">
      <svg viewBox="0 0 1000 490" preserveAspectRatio="xMidYMid meet" className="ws-room-svg" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}floor`} x2="1" y2="1"><stop stopColor="#f3f0e8" /><stop offset="1" stopColor="#e2e5dc" /></linearGradient>
          <linearGradient id={`${id}wood`} x2="0.2" y2="1"><stop stopColor="#faf1df" /><stop offset=".55" stopColor="#eaddc6" /><stop offset="1" stopColor="#d9c7a9" /></linearGradient>
          <linearGradient id={`${id}chair`} x2="1" y2="1"><stop stopColor="#a1ad99" /><stop offset="1" stopColor="#788872" /></linearGradient>
          <linearGradient id={`${id}screen`} x2="1" y2="1"><stop stopColor="#4258b0" /><stop offset="1" stopColor="#222f5c" /></linearGradient>
          <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="15" /></filter>
          <pattern id={`${id}grain`} width="120" height="9" patternUnits="userSpaceOnUse"><path d="M0 4C25 0 50 8 120 4" fill="none" stroke="#a38c68" strokeOpacity=".08" /></pattern>
        </defs>
        <rect width="1000" height="490" fill={`url(#${id}floor)`} />
        <path d="M0 100H1000M0 220H1000M0 340H1000M160 0V100M620 0V100M360 100V220M810 100V220M150 220V340M610 220V340M360 340V490M810 340V490" stroke="#d5d9cd" strokeOpacity=".55" />
        <path d="M85 0H250L680 490H510ZM268 0H425L850 490H700Z" fill="#fffdf0" opacity=".55" />
        <ellipse cx="505" cy="349" rx="285" ry="64" fill="#64745d" opacity=".12" filter={`url(#${id}blur)`} />
        <rect x="191" y="116" width="620" height="290" rx="92" fill="#cdd3c4" opacity=".7" />
        <rect x="205" y="127" width="592" height="266" rx="82" fill="none" stroke="#e2e5da" strokeWidth="2" />
        <g fill="#66745f" opacity=".24"><ellipse cx="208" cy="265" rx="58" ry="68" /><ellipse cx="794" cy="265" rx="58" ry="68" /></g>
        <g fill={`url(#${id}chair)`} stroke="#b5beaa" strokeWidth="2">
          <rect x="147" y="172" width="115" height="128" rx="38" transform="rotate(-9 205 236)" />
          <rect x="738" y="172" width="115" height="128" rx="38" transform="rotate(9 795 236)" />
        </g>
        <path d="M165 193Q148 240 168 280M833 193Q852 240 832 280" stroke="#5b6e54" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M298 287L286 362Q290 374 306 369L326 291M674 291L694 369Q710 374 714 362L702 287" fill="#ad9674" />
        <rect x="264" y="116" width="474" height="220" rx="60" fill="#b5a181" />
        <rect x="260" y="98" width="480" height="220" rx="60" fill={`url(#${id}wood)`} stroke="#fff5e4" strokeWidth="3" />
        <rect x="269" y="107" width="462" height="201" rx="52" fill={`url(#${id}grain)`} />
        <path d="M301 113H690M279 155V254" stroke="#fff8e9" strokeWidth="2" opacity=".7" />
        <g transform="translate(410 115)">
          <ellipse cx="74" cy="108" rx="91" ry="15" fill="#746950" opacity=".13" />
          <path d="M5 0H137L144 85H-2Z" fill="#3c443f" stroke="#adb3a8" strokeWidth="3" />
          <path d="M12 8H130L134 76H8Z" fill={`url(#${id}screen)`} />
          <path d="M-2 85H144L169 111H-23Z" fill="#dce0d6" stroke="#b3bcad" strokeWidth="2" />
          <path d="M11 91H130L143 103H-1Z" fill="#a2aea0" />
          <path d="M54 105H87L93 112H49Z" fill="#b6c1b2" />
          <g fill="#dce8fa" opacity=".8"><rect x="21" y="20" width="55" height="5" rx="2" /><rect x="21" y="34" width="102" height="3" rx="1" opacity=".3" /><rect x="21" y="46" width="30" height="20" rx="3" opacity=".5" /><rect x="58" y="46" width="30" height="20" rx="3" opacity=".35" /><rect x="95" y="46" width="28" height="20" rx="3" opacity=".2" /></g>
        </g>
        <g transform="translate(308 190) rotate(-9)"><rect x="3" y="5" width="69" height="88" rx="6" fill="#8b987e" opacity=".15" /><rect width="69" height="88" rx="5" fill="#fcfaf0" /><path d="M14 21H54M14 31H47M14 42H50M14 62H34" stroke="#c5ceba" strokeWidth="3" /><rect x="57" y="-7" width="5" height="78" rx="2" fill="#4d6275" /></g>
        <g transform="translate(655 149)"><ellipse cy="15" rx="27" ry="15" fill="#9e8e6f" opacity=".16" /><ellipse rx="27" ry="16" fill="#fbf9ee" /><path d="M-17-5V10C-17 27 17 27 17 10V-5" fill="#e5e7d9" /><ellipse cy="-5" rx="17" ry="11" fill="#fdfcf5" /><ellipse cy="-5" rx="12" ry="7" fill="#736049" /><path d="M18 0C36-5 35 18 19 15" stroke="#f6f5e9" strokeWidth="6" fill="none" /></g>
        <g transform="translate(897 355)"><ellipse cy="23" rx="34" ry="14" fill="#8c9c81" opacity=".17" /><path d="M-24-5L-18 31Q0 41 18 31L25-5" fill="#c4b498" /><ellipse cy="-5" rx="25" ry="12" fill="#8b7f64" /><path d="M0-7V-89M0-35L-22-67M0-28L27-56" stroke="#59724e" strokeWidth="4" /><ellipse cx="-18" cy="-64" rx="16" ry="29" transform="rotate(-32 -18 -64)" fill="#829572" /><ellipse cx="24" cy="-60" rx="15" ry="30" transform="rotate(38 24 -60)" fill="#697f5c" /><ellipse cy="-91" rx="13" ry="25" fill="#95a683" /></g>
      </svg>
      <div className="ws-people">{snapshot.members.slice(0, 4).map((member, i) => <button key={member.userId} className="ws-person" style={{ '--person-x': `${[18, 82, 34, 66][i]}%`, '--person-y': `${i < 2 ? 28 : 73}%` } as CSSProperties} onClick={() => onMember(member)} aria-label={`Open ${member.name}'s member details`}><span className="ws-portrait"><Avatar name={member.name} variant={i} /></span><span className="ws-person-label"><strong>{member.name.split(' ')[0]}</strong><small>{snapshot.tasks.filter(t => t.assigneeId === member.userId && t.status !== 'done').length} open tasks</small></span></button>)}</div>
      <button className="ws-context" onClick={onMaterials} aria-label={`Open ${snapshot.materials.length} shared materials`}><svg viewBox="0 0 30 26" aria-hidden="true"><path d="M2 4H12L16 8H28V24H2Z" fill="#bdccb3" /><path d="M6 3H22V20H6Z" fill="#fffdf4" /><path d="M1 12H29L26 25H3Z" fill="#8fa680" /></svg><span><strong>Project context</strong><small>{snapshot.materials.length} original sources</small></span><span aria-hidden="true">↗</span></button>
      <p className="ws-room-note">{demo ? 'Illustrated demo team' : 'Team members, not live presence'} · Select a person or the project folder</p>
    </div>
    <div className="ws-work"><div className="ws-work-heading"><span className="ws-kicker">ON THE TABLE</span><span>{snapshot.tasks.length} shared tasks</span></div><div className="ws-work-cards">{tasks.map(task => <button className="ws-work-card" key={task.id} onClick={() => onTask(task)}><span className={`ws-task-state ws-${task.status}`}>{task.status === 'doing' ? 'IN MOTION' : task.status === 'done' ? 'COMPLETE' : 'UP NEXT'}</span><strong>{task.title}</strong><span className="ws-card-owner">{snapshot.members.find(m => m.userId === task.assigneeId)?.name.split(' ')[0] ?? 'Unassigned'} <b>→</b></span></button>)}</div></div>
  </section>;
}
