'use client';

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OfficeSceneProps } from '../types.ts';
import { assignSeats, contextPath, ROOM_IMAGE, SEATS, TABLE } from './layout.ts';
import './scene.css';

const memoryLabels = ['Goal', 'Owner', 'Constraint', 'Decision', 'Next action'];

function Floorplan() {
  return <svg className="osc-floorplan" viewBox="0 0 900 600" aria-hidden="true">
    <defs><pattern id="osc-floor-grain" width="70" height="28" patternUnits="userSpaceOnUse"><path d="M0 27.5H70M69.5 0V28" stroke="#c6b393" strokeWidth=".6" /><path d="M8 8Q30 3 62 9M12 18Q38 12 59 18" fill="none" stroke="#c6b393" strokeWidth=".3" /></pattern></defs>
    <rect width="900" height="600" fill="#eee8db" /><rect x="30" y="26" width="840" height="548" rx="5" fill="#e4d3b5" /><rect x="30" y="26" width="840" height="548" fill="url(#osc-floor-grain)" />
    <path d="M30 574V26H870V574" fill="none" stroke="#fffdf7" strokeWidth="18" /><path d="M34 90V230M34 270V400" stroke="#a6b3a0" strokeWidth="5" />
    {SEATS.map((seat, index) => <g key={index} transform={`translate(${seat.x * 9} ${seat.y * 6})`}><rect x="-54" y="-5" width="108" height="50" rx="7" fill="#baa483" opacity=".3" transform="translate(4 5)" /><rect x="-54" y="-5" width="108" height="50" rx="7" fill="#f0dfbf" stroke="#bca780" /><rect x="-17" y="6" width="34" height="21" rx="2" fill="#62695d" /><path d="M-21 29H21" stroke="#b3b3a0" strokeWidth="3" /><rect x="-18" y="48" width="36" height="26" rx="9" fill="#8b9979" /></g>)}
    <ellipse cx="432" cy="332" rx="111" ry="58" fill="#b3a184" opacity=".25" /><ellipse cx="432" cy="321" rx="110" ry="57" fill="#f5e5c5" stroke="#bca780" /><rect x="408" y="306" width="42" height="29" rx="3" fill="#fffdf7" transform="rotate(-8 432 321)" />
    {[{x:80,y:70},{x:810,y:90},{x:810,y:530}].map(p => <g key={p.y} transform={`translate(${p.x} ${p.y})`}><circle r="24" fill="#ccd2bb" /><ellipse rx="9" ry="23" fill="#7e9069" transform="rotate(35)" /><ellipse rx="9" ry="22" fill="#697e56" transform="rotate(-40)" /></g>)}
  </svg>;
}

export default function OfficeScene({ people, selectedId, affectedIds = [], layer = 'office', meetingIds = [], onSelectPerson, onSelectPlan, onSelectMemory, compact = false }: OfficeSceneProps) {
  const descriptionId = useId();
  const [imageFailed, setImageFailed] = useState(false);
  const assignments = assignSeats(people);
  const visible = assignments.filter(item => item.index >= 0);
  const meeting = visible.filter(item => meetingIds.includes(item.person.id));
  const memory = layer === 'memory';
  const affected = visible.filter(item => affectedIds.includes(item.person.id));
  const connections = visible.filter(item => affectedIds.includes(item.person.id) || selectedId === item.person.id || meetingIds.includes(item.person.id));

  return <section className={`osc-scene${memory ? ' osc-memory' : ''}${compact ? ' osc-compact' : ''}${imageFailed ? ' osc-image-failed' : ''}${assignments.some(item => item.index < 0) || people.length === 0 ? ' osc-has-overflow' : ''}`} aria-label="Interactive shared office" aria-describedby={descriptionId}>
    <div className="osc-room">
      {imageFailed ? <Floorplan /> : <img className="osc-room-image" src={ROOM_IMAGE} alt="Sunlit studio with six individual desks and a shared central table. Room artwork, not live attendance." width={1536} height={1024} draggable={false} decoding="async" fetchPriority="high" onError={() => setImageFailed(true)} />}
      <svg className="osc-context" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {connections.map(({ person, index }) => {
          const seat = SEATS[index];
          const isMeeting = meetingIds.includes(person.id);
          return <g key={person.id} className={affectedIds.includes(person.id) ? 'osc-path-affected' : 'osc-path-selected'}><path className="osc-path-underlay" d={contextPath(seat.x, seat.y)} /><path className={`osc-path${isMeeting ? ' osc-meeting-path' : ''}`} d={contextPath(seat.x, seat.y)} /><circle cx={seat.x} cy={seat.y} r=".6" className="osc-path-origin" /></g>;
        })}
        {connections.length > 0 && <circle cx={TABLE.x} cy={TABLE.y} r=".8" className="osc-path-target" />}
      </svg>

      <button className="osc-table-hit" onClick={onSelectPlan} aria-label="Open shared team plan" title="Open shared team plan"><span className="osc-table-label"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12v8H2zM5 4v8M2 7h12" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>Shared plan<span aria-hidden="true">↗</span></span></button>

      {visible.map(({ person, index }) => {
        const seat = SEATS[index];
        const meetingIndex = meeting.findIndex(item => item.person.id === person.id);
        const atTable = meetingIndex >= 0;
        const isAffected = affectedIds.includes(person.id);
        // Only participant labels move; the supplied artwork is never manipulated.
        const x = atTable ? 37 + (meetingIndex % 3) * 11 : seat.x;
        const y = atTable ? 47 + Math.floor(meetingIndex / 3) * 8 : seat.y;
        return <button key={person.id} className={`osc-seat${selectedId === person.id ? ' is-selected' : ''}${isAffected ? ' is-affected' : ''}${atTable ? ' is-meeting' : ''}`} style={{ left: `${x}%`, top: `${y}%`, '--osc-seat-color': person.color } as CSSProperties} onClick={() => onSelectPerson(person.id)} aria-label={`Select ${person.name}, ${person.role}${isAffected ? ', affected by change' : ''}${atTable ? ', proposed coordination participant' : ''}`} aria-pressed={selectedId === person.id} title={`${person.name} · ${person.role}\n${person.objective}`}><span className="osc-seat-pill"><span className="osc-seat-dot" aria-hidden="true" /><span className="osc-seat-name">{person.name.split(' ')[0]}</span>{isAffected && <span className="osc-change-mark" aria-hidden="true">!</span>}</span><span className="osc-seat-detail">{atTable ? 'Planning preview' : isAffected ? 'Change to review' : person.role}</span></button>;
      })}

      {meeting.length > 0 && <div className="osc-meeting-note">{meeting.length} proposed participants<span>Planning preview, not attendance</span></div>}
      <div className="osc-memory-wash" aria-hidden="true" />
      {memory && <div className="osc-memory-foundation"><span className="osc-foundation-caption">Shared context beneath the work</span><div className="osc-memory-nodes" aria-hidden="true">{memoryLabels.map((label, index) => <span key={label}><i>{String(index + 1).padStart(2, '0')}</i>{label}</span>)}</div></div>}
      <button className="osc-memory-button" onClick={onSelectMemory} aria-label="Open shared memory" aria-pressed={memory}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="m9 2 7 4-7 4-7-4 7-4Zm-7 8 7 4 7-4M2 14l7 3 7-3" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg><span>{memory ? 'Inspect memory & sources' : 'Shared memory'}</span><span aria-hidden="true">↗</span></button>
      {affected.length > 0 && <span className="osc-change-key"><i aria-hidden="true" />{affected.length} affected {affected.length === 1 ? 'seat' : 'seats'}</span>}
    </div>

    <div className="osc-roster" role="group" aria-label="Office seats">
      {assignments.map(({ person, index }) => <button key={person.id} className={`${selectedId === person.id ? 'is-selected ' : ''}${affectedIds.includes(person.id) ? 'is-affected' : ''}`} aria-label={`Open seat for ${person.name}`} aria-pressed={selectedId === person.id} onClick={() => onSelectPerson(person.id)}><span className="osc-roster-number">{index >= 0 ? String(index + 1).padStart(2, '0') : '+'}</span><span><strong>{person.name}</strong><small>{person.role}{index < 0 ? ' · roster only' : ''}</small></span>{affectedIds.includes(person.id) && <span className="osc-roster-attention" aria-label="Affected by change">!</span>}</button>)}
      {people.length === 0 && <p className="osc-no-seats">No assigned seats. The shared plan and memory are still available.</p>}
    </div>
    <p id={descriptionId} className="osc-honesty">{imageFailed ? 'Spatial floor plan. ' : 'Illustrated room. '}{assignments.length} assigned {assignments.length === 1 ? 'seat' : 'seats'}. Figures are part of the artwork, not membership or live presence.{meeting.length > 0 ? ' Moving labels show proposed coordination only.' : ''}</p>
  </section>;
}
