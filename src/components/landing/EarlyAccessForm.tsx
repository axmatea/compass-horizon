"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";

type FormState = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

export function EarlyAccessForm() {
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const submitting = state.kind === "submitting";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const company = String(data.get("company") ?? "").trim();
    if (!email) {
      setState({ kind: "error", message: "Please enter your email address." });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await api.earlyAccess({
        email,
        name: name || undefined,
        company: company || undefined,
      });
      if (res && res.ok === true) {
        setState({ kind: "success" });
      } else {
        setState({ kind: "error", message: "The request was not confirmed by the server. Nothing was saved, please try again." });
      }
    } catch (err) {
      setState({ kind: "error", message: errorMessage(err) });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="ld-form ld-form--done" role="status">
        <span className="lv-pill lv-pill--ok">
          <span className="lv-dot" aria-hidden="true" />
          Received
        </span>
        <p className="ld-form-done">You are on the list. We will reach out personally.</p>
      </div>
    );
  }

  return (
    <form className="ld-form" onSubmit={onSubmit} aria-describedby="ld-pricing">
      <div className="ld-field">
        <label htmlFor="ld-email" className="ld-label">
          Work email <span className="ld-req">required</span>
        </label>
        <input
          id="ld-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="ld-input"
          placeholder="you@company.com"
          disabled={submitting}
          aria-invalid={state.kind === "error" ? true : undefined}
          aria-errormessage={state.kind === "error" ? "ld-form-error" : undefined}
        />
      </div>
      <div className="ld-field-row">
        <div className="ld-field">
          <label htmlFor="ld-name" className="ld-label">
            Name <span className="ld-opt">optional</span>
          </label>
          <input id="ld-name" name="name" type="text" autoComplete="name" className="ld-input" disabled={submitting} />
        </div>
        <div className="ld-field">
          <label htmlFor="ld-company" className="ld-label">
            Company <span className="ld-opt">optional</span>
          </label>
          <input
            id="ld-company"
            name="company"
            type="text"
            autoComplete="organization"
            className="ld-input"
            disabled={submitting}
          />
        </div>
      </div>
      {state.kind === "error" ? (
        <p id="ld-form-error" className="ld-form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="ld-form-actions">
        <button type="submit" className="lv-btn lv-btn--primary ld-submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Sending request..." : "Request early access"}
        </button>
      </div>
    </form>
  );
}
