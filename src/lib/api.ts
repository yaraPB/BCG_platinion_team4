/** Browser-side calls go to the same-origin proxy (/api/v1/...), which attaches the session token. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path.replace(/^\/+/, "")}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (response.status === 401) {
    window.location.assign("/login?expired=1");
    throw new ApiError(401, "Your session has expired.");
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, typeof result.error === "string" ? result.error : "Request failed.");
  return result as T;
}

export const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
export const pct = (value: number) => `${Math.round(value * 100)}%`;
export const hours = (value: number) => (value >= 48 ? `${(value / 24).toFixed(1)} days` : `${Math.round(value)} h`);
