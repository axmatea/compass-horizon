'use client';

import '../tokens.css';
import './story.css';
import { Coordination, MemoryList, SourceNote } from './StoryParts';
import { STORY_PEOPLE } from './content';

type NarrativeProps = { onEnterOffice: () => void; onExploreMemory: () => void };

export default function Narrative({ onEnterOffice, onExploreMemory }: NarrativeProps) {
  return <section id="the-idea" className="office-universe office-story os-narrative" aria-labelledby="os-narrative-title">
    <div className="os-editorial-intro"><p className="of-kicker">The room above, the reason underneath</p><h2 id="os-narrative-title">Six independent seats.<br /><em>One shared direction.</em></h2><p className="os-intro-copy">A desk holds a person&apos;s work. The central table holds the plan. Shared context keeps the two in conversation.</p></div>

    <ol className="os-seat-register" aria-label="Six fictional Harbor studio teammates">{STORY_PEOPLE.map((person, index) => <li key={person.id}><span className="os-seat-number">0{index + 1}</span><strong>{person.name}</strong><small>{person.role}</small></li>)}</ol>

    <div className="os-editorial-chapter">
      <div className="os-chapter-label"><span>01</span><p className="of-kicker">A shared plan</p></div>
      <div><h3>One late delivery.<br /><em>Not six interruptions.</em></h3><p className="os-body-copy">Harbor studio&apos;s supplier moves delivery from Wednesday, September 30 to Thursday, October 1. The proposed change follows the dependency, not the whole room.</p>
        <ol className="os-dependency-line" aria-label="Proposed dependency changes"><li><span>Noa / supplier handover</span><strong>Thursday, Oct 1</strong><small>Changed from Wednesday</small></li><li><span>Leo / installation</span><strong>Thursday, Oct 1</strong><small>Proposed move from Wednesday</small></li><li><span>Leo / validation</span><strong>Friday, Oct 2 · 09:00</strong><small>Proposed move from Thursday</small></li></ol>
        <p className="os-kept"><span aria-hidden="true">=</span> Client preview stays Friday, October 2 at 15:00.</p><p className="os-fine">Maya&apos;s approval is required. This narrative does not apply the proposed plan.</p>
      </div>
    </div>

    <div className="os-editorial-chapter"><div className="os-chapter-label"><span>02</span><p className="of-kicker">Only necessary coordination</p></div><div><h3>A smaller conversation.<br /><em>A clearer handoff.</em></h3><p className="os-body-copy">Two people share this dependency. Give them the relevant context, and let the rest of the room keep its rhythm.</p><Coordination /><p className="os-fine">A scripted proposal for Noa and Leo only. No calendar booking or notification.</p></div></div>

    <div className="os-editorial-chapter os-memory-chapter"><div className="os-chapter-label"><span>03</span><p className="of-kicker">Shared memory underneath</p></div><div><h3>The next step,<br /><em>with its reason intact.</em></h3><p className="os-body-copy">A useful context packet is a focused reading of the situation, not a replacement for the original. Keep both within reach.</p><MemoryList /><SourceNote /><button className="of-text-button" type="button" onClick={onExploreMemory}>Explore the shared memory <span aria-hidden="true">↗</span></button></div></div>

    <div className="os-editorial-close"><div><p className="of-kicker">COMPASS / NAYL &amp; Vincent</p><h3>Right context.<br /><em>Right person.</em></h3><p className="os-body-copy">The team moves together, without everyone moving at once.</p></div><button type="button" className="of-button of-button-primary" onClick={onEnterOffice}>Return to the office <span aria-hidden="true">↗</span></button></div>
    <p className="os-disclaimer">Harbor studio is a fictional, local demonstration. Changes and coordination are scripted, not automatic. No AI calls, live presence, compression claims, messages, or bookings.</p>
  </section>;
}
