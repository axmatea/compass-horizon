/** Small hand-drawn line glyphs for the primitives grid. Decorative only. */

export type PrimitiveKey = "ledger" | "commitments" | "beliefs" | "runs" | "time";

export function PrimitiveIcon({ name }: { name: PrimitiveKey }) {
  return (
    <svg className="ld-prim-icon" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
      {name === "ledger" ? (
        <g>
          <line x1="6" y1="12" x2="34" y2="12" />
          <line x1="6" y1="20" x2="34" y2="20" />
          <line x1="6" y1="28" x2="34" y2="28" />
          <circle className="ld-prim-fill" cx="11" cy="12" r="2.2" />
          <circle className="ld-prim-fill" cx="19" cy="20" r="2.2" />
          <circle className="ld-prim-fill" cx="27" cy="28" r="2.2" />
          <path className="ld-prim-soft" d="M27 28 Q 19 34 11 28" />
        </g>
      ) : null}
      {name === "commitments" ? (
        <g>
          <circle cx="18" cy="21" r="11" />
          <line x1="18" y1="21" x2="18" y2="14" />
          <line x1="18" y1="21" x2="23" y2="24" />
          <path d="M31 8 L35 8 L35 12" />
          <path d="M26 13 L35 8" />
        </g>
      ) : null}
      {name === "beliefs" ? (
        <g>
          <rect className="ld-prim-soft" x="12" y="6" width="22" height="15" rx="3" />
          <rect className="ld-prim-soft" x="9" y="11" width="22" height="15" rx="3" />
          <rect className="ld-prim-panel" x="6" y="16" width="22" height="15" rx="3" />
          <line x1="10" y1="22" x2="20" y2="22" />
          <line x1="10" y1="26" x2="16" y2="26" />
        </g>
      ) : null}
      {name === "runs" ? (
        <g>
          <rect className="ld-prim-fillbox" x="4" y="16" width="7" height="8" rx="1.5" />
          <rect className="ld-prim-fillbox" x="13" y="16" width="7" height="8" rx="1.5" />
          <path className="ld-prim-break" d="M22.5 13 L25 18 L22.5 22 L25 27" />
          <rect x="27" y="16" width="7" height="8" rx="1.5" />
          <line x1="37" y1="20" x2="38" y2="20" />
        </g>
      ) : null}
      {name === "time" ? (
        <g>
          <line x1="4" y1="26" x2="36" y2="26" />
          <line className="ld-prim-soft" x1="24" y1="9" x2="24" y2="26" />
          <circle className="ld-prim-panel" cx="24" cy="26" r="4" />
          <circle className="ld-prim-fill" cx="24" cy="26" r="1.5" />
          <path d="M14 12 L9 12 M9 12 L12 9 M9 12 L12 15" />
        </g>
      ) : null}
    </svg>
  );
}
