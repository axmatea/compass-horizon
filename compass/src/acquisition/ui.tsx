import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { errorMessage } from "./api";
import type { Qualification } from "./types";

export type IconName =
  | "compass"
  | "mission"
  | "experiments"
  | "pipeline"
  | "memory"
  | "arrow"
  | "plus"
  | "check"
  | "close"
  | "settings"
  | "play"
  | "refresh"
  | "search"
  | "mic"
  | "logout"
  | "info";
const paths: Record<IconName, ReactNode> = {
  compass: (
    <>
      <path d="m15.5 4.5-2 9-9 2 2-9z" />
      <path d="m6.5 6.5 7 7M10 1v2M10 17v2M1 10h2M17 10h2" />
    </>
  ),
  mission: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3" />
      <path d="m10 10 7-7M14 3h3v3" />
    </>
  ),
  experiments: (
    <>
      <path d="M7 2h6M8 2v6l-5 8a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-8V2M6 12h8" />
      <path d="M8 15h.01M12 14h.01" />
    </>
  ),
  pipeline: (
    <>
      <rect x="2" y="3" width="4" height="14" rx="1" />
      <rect x="8" y="3" width="4" height="10" rx="1" />
      <rect x="14" y="3" width="4" height="6" rx="1" />
    </>
  ),
  memory: (
    <>
      <path d="m10 2 8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" />
    </>
  ),
  arrow: <path d="M3 10h13m-5-5 5 5-5 5" />,
  plus: <path d="M10 3v14M3 10h14" />,
  check: <path d="m4 10 4 4 8-8" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  settings: (
    <>
      <path d="M3 5h14M3 10h14M3 15h14" />
      <circle cx="7" cy="5" r="2" />
      <circle cx="13" cy="10" r="2" />
      <circle cx="8" cy="15" r="2" />
    </>
  ),
  play: <path d="m7 4 9 6-9 6z" />,
  refresh: (
    <>
      <path d="M16 7a7 7 0 1 0 0 7M17 2v5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m13 13 4 4" />
    </>
  ),
  mic: (
    <>
      <rect x="7" y="2" width="6" height="10" rx="3" />
      <path d="M4 9a6 6 0 0 0 12 0M10 15v3M7 18h6M2 2l16 16" />
    </>
  ),
  logout: (
    <>
      <path d="M8 3H3v14h5M8 10h10m-4-4 4 4-4 4" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5M10 6v.1" />
    </>
  ),
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="section-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function AsyncForm({
  children,
  onSubmit,
  submit,
  hint,
  className = "",
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  submit: string;
  hint?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await onSubmit(data);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={handleSubmit}
      className={`form-stack ${className}`}
      aria-busy={pending}
    >
      <fieldset disabled={pending}>{children}</fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending} type="submit">
        {pending ? (
          <>
            <span className="spinner" /> Saving...
          </>
        ) : (
          <>
            {submit}
            <Icon name="arrow" />
          </>
        )}
      </button>
      {hint && <p className="fine-print">{hint}</p>}
    </form>
  );
}

export const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
export function nullableNumber(data: FormData, key: string): number | null {
  const raw = value(data, key);
  if (raw === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0)
    throw new Error("Enter a valid non-negative number.");
  return number;
}
export function nullableBoolean(data: FormData, key: string): boolean | null {
  return value(data, key) === "" ? null : value(data, key) === "true";
}
export function BooleanField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: boolean | null;
}) {
  return (
    <label>
      {label}
      <select
        name={name}
        defaultValue={defaultValue == null ? "" : String(defaultValue)}
      >
        <option value="">Not known yet</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}
export function QualificationBadge({
  status,
}: {
  status: Qualification["status"];
}) {
  const label = {
    QUALIFIED: "Qualified",
    NEEDS_CONTEXT: "Needs context",
    NOT_ICP: "Not a fit",
  };
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span className="status-dot" />
      {label[status]}
    </span>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Icon name="compass" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Creative({ index, title }: { index: number; title: string }) {
  const first = index % 2 === 0;
  const id = useId();
  return (
    <svg
      viewBox="0 0 480 320"
      role="img"
      aria-labelledby={id}
      className={`creative creative-${index % 3}`}
    >
      <title id={id}>
        {title}. Concept creative, not a published advertisement.
      </title>
      <rect width="480" height="320" fill={first ? "#e6e8db" : "#234ed8"} />
      <g fill={first ? "#25382d" : "#f5f4ee"} fontFamily="Manrope, sans-serif">
        <text x="28" y="37" fontSize="10" letterSpacing="3">
          AI MEDIA GLOBAL / WORKFLOW NOTES
        </text>
        <text x="28" y="111" fontSize="49" fontWeight="650" letterSpacing="-2">
          {first ? "They replied." : "Less busywork."}
        </text>
        <text x="28" y="167" fontSize="49" fontWeight="650" letterSpacing="-2">
          {first ? "Now what?" : "More flow."}
        </text>
        <text x="28" y="285" fontSize="10" letterSpacing="1">
          {first
            ? "PUT AI TO WORK ON THE FOLLOW-UP."
            : "ONE PROCESS. ONE USEFUL AI WORKFLOW."}
        </text>
        <text x="427" y="285" fontSize="11">
          0{index + 1}
        </text>
      </g>
      {first ? (
        <g fill="none" stroke="#59765b" strokeWidth="1.2">
          <path
            d="M305 60v184M333 60v184M361 60v184M389 60v184M417 60v184"
            opacity=".16"
          />
          <path d="m302 213 44-30 36 14 61-58" />
          <path d="m427 139 16 0 0 16" />
        </g>
      ) : (
        <g fill="none" stroke="#cedafa" strokeWidth="1.2" opacity=".65">
          <rect x="330" y="182" width="90" height="51" />
          <rect x="345" y="194" width="90" height="51" />
          <path d="M359 218h60m-7-6 7 6-7 6" />
        </g>
      )}
      <path
        d="M28 253h424"
        stroke={first ? "#25382d" : "#f5f4ee"}
        opacity=".2"
      />
    </svg>
  );
}
