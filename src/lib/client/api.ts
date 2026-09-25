/**
 * Typed client for the Longview API (see the list at the bottom of src/contract.ts).
 * Same-origin, JSON, workspace comes from the httpOnly cookie set by the server.
 *
 * Mock mode: only when NEXT_PUBLIC_LV_MOCK=1 at build time. The client never
 * falls back to the mock when the real API fails; failures surface as ApiError.
 */
import type {
  AdvanceResponse,
  BeatResponse,
  ChaosResponse,
  HealthResponse,
  ReplayResponse,
  ResetResponse,
  WakeResponse,
  WorldView,
} from "@/contract";

export const IS_MOCK = process.env.NEXT_PUBLIC_LV_MOCK === "1";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  /** 409 {code:'INTERRUPTED'}: a run is waiting to be resumed. */
  get interrupted(): boolean {
    return this.code === "INTERRUPTED";
  }
}

/** A failed call that means "the worker died mid-run": an explicit INTERRUPTED
 *  code, or any 5xx / dropped connection while chaos was armed. */
export function isWorkerDeath(err: unknown, chaosArmed: boolean): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "INTERRUPTED") return true;
  return chaosArmed && (err.status >= 500 || err.status === 0);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

type Json = Record<string, unknown>;

async function request<T>(path: string, method: "GET" | "POST" = "GET", json?: Json): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: json !== undefined ? { "content-type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : method === "POST" ? "{}" : undefined,
    });
  } catch {
    throw new ApiError("The worker did not answer (connection closed).", 0, "NETWORK");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: unknown; code?: unknown };
    const message = typeof b.error === "string" && b.error ? b.error : `Request failed with HTTP ${res.status}`;
    const code = typeof b.code === "string" ? b.code : undefined;
    throw new ApiError(message, res.status, code);
  }
  if (body === null) throw new ApiError("Empty or invalid JSON from the API.", res.status, "BAD_JSON");
  return body as T;
}

async function mockModule() {
  return import("./mock");
}

export interface StateQuery {
  asOf?: number | null;
  stage?: string | null;
}

export interface EventInput {
  source: string;
  externalId: string;
  type: string;
  leadId?: string;
  occurredAt: string;
  payload: Json;
}

export interface EarlyAccessInput {
  email: string;
  name?: string;
  company?: string;
}

export const api = {
  mock: IS_MOCK,

  async state(q: StateQuery = {}): Promise<WorldView> {
    if (IS_MOCK) return (await mockModule()).mockApi.state(q);
    const p = new URLSearchParams();
    if (q.asOf !== undefined && q.asOf !== null) p.set("asOf", String(q.asOf));
    if (q.stage) p.set("stage", q.stage);
    const qs = p.toString();
    return request<WorldView>(`/api/state${qs ? `?${qs}` : ""}`);
  },

  async beat(): Promise<BeatResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.beat();
    return request<BeatResponse>("/api/demo/beat", "POST");
  },

  async advance(days: number): Promise<AdvanceResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.advance(days);
    return request<AdvanceResponse>("/api/demo/advance", "POST", { days });
  },

  async reset(): Promise<ResetResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.reset();
    return request<ResetResponse>("/api/demo/reset", "POST");
  },

  async chaos(afterStep = 3): Promise<ChaosResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.chaos(afterStep);
    return request<ChaosResponse>("/api/demo/chaos", "POST", { afterStep });
  },

  async replayWebhook(): Promise<ReplayResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.replayWebhook();
    return request<ReplayResponse>("/api/demo/replay-webhook", "POST");
  },

  async wake(): Promise<WakeResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.wake();
    return request<WakeResponse>("/api/wake", "POST");
  },

  async sendEvent(input: EventInput): Promise<{ duplicate: boolean; world: WorldView }> {
    if (IS_MOCK) return (await mockModule()).mockApi.sendEvent(input);
    return request<{ duplicate: boolean; world: WorldView }>("/api/events", "POST", input as unknown as Json);
  },

  async health(): Promise<HealthResponse> {
    if (IS_MOCK) return (await mockModule()).mockApi.health();
    return request<HealthResponse>("/api/health");
  },

  async earlyAccess(input: EarlyAccessInput): Promise<{ ok: boolean }> {
    if (IS_MOCK) return (await mockModule()).mockApi.earlyAccess(input);
    return request<{ ok: boolean }>("/api/early-access", "POST", input as unknown as Json);
  },
};

export type Api = typeof api;
