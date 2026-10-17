import { cookies } from "next/headers";
import { backendUrl, SESSION_COOKIE } from "@/lib/server/backend";

const MAX_BODY_BYTES = 64 * 1024;

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  let url: string;
  try {
    url = backendUrl(path, new URL(request.url).search);
  } catch {
    return Response.json({ error: "Invalid API path." }, { status: 400 });
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });

  const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) return Response.json({ error: "Request body too large." }, { status: 413 });
    headers.set("Content-Type", "application/json");
  }
  try {
    const upstream = await fetch(url, { method: request.method, headers, body, cache: "no-store" });
    const text = await upstream.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!upstream.ok) {
      const detail = payload && typeof payload === "object" && "detail" in payload ? (payload as { detail: unknown }).detail : null;
      const error = typeof detail === "string" ? detail : Array.isArray(detail) ? "Invalid request." : "The planning service returned an error.";
      return Response.json({ error }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
    }
    if (upstream.status === 204) return new Response(null, { status: 204 });
    return Response.json(payload, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The planning service is unreachable." }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as DELETE };
