/**
 * Server-only access to the FoodBridge API. The browser never sees the bearer token: it lives in an httpOnly cookie and
 * is attached here, in Next.js route handlers and server components.
 */
export const SESSION_COOKIE = "vm_session";

export function apiBaseUrl(): string {
  return (process.env.VIAMENSA_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Builds a backend URL for a proxied path, refusing anything that is not a plain /v1/... path (no traversal, no hosts). */
export function backendUrl(segments: string[], search = ""): string {
  if (!segments.length || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) {
    throw new Error("Invalid API path");
  }
  const query = search && search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${apiBaseUrl()}/v1/${segments.join("/")}${query}`;
}

export class BackendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function backendJson<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new BackendError(response.status, typeof body.detail === "string" ? body.detail : "Request failed");
  return body as T;
}
