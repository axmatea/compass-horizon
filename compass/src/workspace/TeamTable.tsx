import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { Member, Snapshot, Task } from './types.ts';
import { calcFacing } from './facing.ts';

export function Avatar({ name, variant = 0, small = false }: { name: string; variant?: number; small?: boolean }) {
  const id = useId().replace(/:/g, '');
  const warm = variant % 2 === 0;
  return <svg className={small ? 'cw-avatar cw-avatar-small' : 'cw-avatar'} viewBox="0 0 120 130" role="img" aria-label={`Illustrated avatar for ${name}`}>
    <defs><linearGradient id={`${id}-shirt`} x2=".8" y2="1"><stop stopColor={warm ? '#83918a' : '#5d7ada'} /><stop offset="1" stopColor={warm ? '#435e53' : '#304eaa'} /></linearGradient></defs>
    <ellipse cx="60" cy="118" rx="43" ry="8" fill="#30322d" opacity=".12" />
    <path d="M23 111V91Q22 68 47 66H73Q99 69 97 94V111Q63 128 23 111" fill={`url(#${id}-shirt)`} />
    <path d="M43 71L60 88L77 71M37 84L33 111M83 85L87 112" fill="none" stroke={warm ? '#a8b7a6' : '#88a3ed'} strokeWidth="2" opacity=".65" />
    <path d="M50 58H70V73Q60 83 50 73Z" fill={warm ? '#c99472' : '#cf926f'} />
    {warm && <path d="M32 49Q23 15 55 12Q92 8 91 47L94 77L74 80L71 48Z" fill="#353331" />}
    <ellipse cx="60" cy="44" rx="25" ry="30" fill={warm ? '#e8b992' : '#e9b38e'} />
    <ellipse cx="36" cy="48" rx="5" ry="7" fill="#d99f7e" /><ellipse cx="84" cy="48" rx="5" ry="7" fill="#d99f7e" />
    {warm ? <path d="M35 42Q28 16 48 13Q76 2 85 29L84 43L76 27Q61 40 39 31Z" fill="#353331" /> : <path d="M36 40Q26 21 41 18Q37 9 51 12Q58 1 70 12Q87 6 85 23Q99 26 83 44L77 27Q58 34 42 28Z" fill="#644436" />}
    <path d="M44 44L51 43M68 43L76 44" stroke="#664433" strokeWidth="2" strokeLinecap="round" />
    <circle cx="48" cy="48" r="1.6" fill="#34332f" /><circle cx="72" cy="48" r="1.6" fill="#34332f" />
    <path d="M59 48L56 56H61M53 62Q60 67 68 61" fill="none" stroke="#a6644d" strokeWidth="1.6" strokeLinecap="round" />
    {!warm && <g stroke="#3a4144" strokeWidth="1.8" fill="none"><rect x="40" y="42" width="16" height="12" rx="4" /><rect x="64" y="42" width="16" height="12" rx="4" /><path d="M56 46H64" /></g>}
    {warm && <g fill="#d7b169"><circle cx="35" cy="55" r="3" /><circle cx="85" cy="55" r="3" /></g>}
    <path d="M25 96Q16 110 32 114L48 110M95 96Q104 110 89 114L73 110" fill="none" stroke={warm ? '#e8b992' : '#e9b38e'} strokeWidth="11" strokeLinecap="round" />
  </svg>;
}

export function TeamTable({ snapshot, onMember, onTask, onMaterials, lastEvent, demo }: {
  snapshot: Snapshot; onMember: (member: Member) => void; onTask: (task: Task) => void; onMaterials: () => void; lastEvent: string; demo: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const members = snapshot.members.slice(0, 4);
  const actor = snapshot.events.find(e => e.id === lastEvent)?.actorId;
  const positions = members.length <= 2 ? [[24, 24], [77, 60]] : [[23, 23], [77, 23], [23, 62], [77, 62]];
  const featured = [...snapshot.tasks.filter(t => t.status === 'doing'), ...snapshot.tasks.filter(t => t.status === 'todo'), ...snapshot.tasks.filter(t => t.status === 'done')].slice(0, 3);
  return <section className="cw-room" aria-label="Interactive team table">
    <div className="cw-room-heading"><span className="cw-eyebrow">A PLACE TO MAKE IT HAPPEN</span><span className="cw-room-index">01 / THE TABLE</span></div>
    <svg className="cw-room-art" viewBox="0 0 900 530" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-floor`} x2="1" y2="1"><stop stopColor="#eeece4" /><stop offset="1" stopColor="#e0e2d9" /></linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f4e9d7" /><stop offset="1" stopColor="#dbcbb1" /></linearGradient>
        <linearGradient id={`${id}-edge`} x2="0" y2="1"><stop stopColor="#cdb999" /><stop offset="1" stopColor="#ad9675" /></linearGradient>
        <filter id={`${id}-shadow`} x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="16" /></filter>
        <pattern id={`${id}-grid`} width="110" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)"><path d="M110 0H0V70" stroke="#a9b3a0" strokeOpacity=".17" /></pattern>
      </defs>
      <rect width="900" height="530" fill={`url(#${id}-floor)`} />
      <path d="M600 0H850L260 530H10Z" fill="#fffcf1" opacity=".38" />
      <rect width="900" height="530" fill={`url(#${id}-grid)`} />
      <ellipse cx="460" cy="363" rx="289" ry="76" fill="#596355" opacity=".2" filter={`url(#${id}-shadow)`} />
      <path d="M257 300V379Q273 396 286 380L303 306M600 305L622 385Q637 396 648 381V301" fill="#b19c7e" />
      <path d="M164 254C164 178 293 140 449 140S739 178 739 254V280C739 356 608 392 449 392S164 353 164 280Z" fill={`url(#${id}-edge)`} />
      <ellipse cx="451" cy="252" rx="288" ry="128" fill={`url(#${id}-top)`} stroke="#f8efdf" strokeWidth="3" />
      <ellipse cx="451" cy="252" rx="273" ry="114" stroke="#aa9170" strokeOpacity=".13" />
      <path d="M205 255C275 313 567 355 704 264M210 237C335 314 550 317 695 245" stroke="#aa9170" strokeOpacity=".12" />
      <g transform="translate(660 155) rotate(12)"><ellipse cx="0" cy="16" rx="25" ry="13" fill="#b9ac93" opacity=".4" /><ellipse rx="21" ry="14" fill="#f9f7ee" /><path d="M-21 0V16C-21 34 21 34 21 16V0" fill="#eee9da" /><ellipse rx="17" ry="10" fill="#b39472" /><ellipse rx="13" ry="7" fill="#624a36" /><path d="M22 3C42-1 38 23 23 18" stroke="#f9f7ee" strokeWidth="7" /></g>
      <g transform="translate(116 385)"><ellipse cy="24" rx="35" ry="13" fill="#83917d" opacity=".17" /><path d="M-22 0L-15 33Q0 44 16 33L23 0" fill="#c7b297" /><ellipse rx="23" ry="9" fill="#ad947a" /><path d="M0 0V-75M0-19L-24-46M1-36L27-66" stroke="#70816a" strokeWidth="4" /><ellipse cx="-17" cy="-49" rx="12" ry="24" transform="rotate(-39 -17 -49)" fill="#81967a" /><ellipse cx="22" cy="-64" rx="13" ry="24" transform="rotate(39 22 -64)" fill="#687e63" /><ellipse cx="0" cy="-79" rx="11" ry="22" fill="#8fa183" /></g>
      <g transform="translate(554 326) rotate(-17)"><rect width="65" height="7" rx="3" fill="#3b4a8c" /><rect x="8" width="4" height="7" fill="#aaadbf" /><path d="M65 0L76 3.5L65 7" fill="#ad9272" /></g>
    </svg>
    {members.map((member, i) => <button key={member.userId} className={`cw-seat ${actor === member.userId ? 'cw-seat-event' : ''}`} data-facing={calcFacing(positions[i][0],positions[i][1],50,45)} style={{ '--seat-x': `${positions[i][0]}%`, '--seat-y': `${positions[i][1]}%` } as CSSProperties} onClick={() => onMember(member)} aria-label={`Open ${member.name}'s member details`}>
      <Avatar key={actor === member.userId ? lastEvent : 'idle'} name={member.name} variant={i} /><span className="cw-seat-name">{member.name.split(' ')[0]}<span>{snapshot.tasks.filter(t => t.assigneeId === member.userId && t.status !== 'done').length} open tasks</span></span>
    </button>)}
    <div className="cw-table-cards" key={lastEvent || 'initial'}>{featured.map((task, i) => <button key={task.id} className={`cw-table-card cw-card-${i} ${lastEvent ? 'cw-event-change' : ''}`} onClick={() => onTask(task)}>
      <span className={`cw-status-dot ${task.status}`} /><span className="cw-table-card-label">{task.status === 'doing' ? 'IN MOTION' : task.status === 'done' ? 'DONE' : 'UP NEXT'}</span><strong>{task.title}</strong><span className="cw-card-rule" /><small>{snapshot.members.find(m => m.userId === task.assigneeId)?.name.split(' ')[0] ?? 'Unassigned'}</small>
    </button>)}</div>
    <button className="cw-table-materials" onClick={onMaterials} aria-label={`Open ${snapshot.materials.length} shared materials`}><svg viewBox="0 0 62 48" aria-hidden="true"><path d="M2 10Q2 5 7 5H24L31 12H56Q60 12 60 17V43H2Z" fill="#9dafa1" /><rect x="7" y="9" width="47" height="30" rx="2" fill="#fffdf6" /><path d="M14 17H43M14 23H36" stroke="#c7cbc2" strokeWidth="2" /><path d="M2 22Q2 18 6 18H57Q62 18 61 23L56 45H4Z" fill="#b6c4b3" /></svg><span>Shared context <b>{snapshot.materials.length}</b></span></button>
    <div className="cw-room-caption"><span>Pull up a chair.</span><small>{demo ? 'Fictional people. Real interactions.' : 'Members shown, not online presence.'}</small></div>
  </section>;
}
