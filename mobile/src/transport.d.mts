export const COMPASS_ORIGIN: string;
export const SESSION_COOKIE: string;

export class CompassApiError extends Error {
  code: string;
  status: number;
}

type Storage = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
};
type Options = {
  method?: 'GET' | 'POST' | 'PUT';
  json?: unknown;
  bytes?: ArrayBuffer;
  mime?: 'image/jpeg' | 'image/png';
  appVersion?: number;
  key?: string;
};

export function readSessionCookie(headers: Headers): string | null;
export function checkedId(value: unknown): string;
export function createTransport(fetcher: typeof fetch, storage: Storage): {
  restore(): Promise<{userId: string} | null>;
  signIn(email: string, password: string): Promise<{userId: string}>;
  signOut(): Promise<void>;
  request<T>(path: string, options?: Options): Promise<T>;
};
