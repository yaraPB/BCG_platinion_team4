import { cookies } from "next/headers";
import { BackendError, backendJson, SESSION_COOKIE } from "@/lib/server/backend";

interface TokenResponse { accessToken: string; expiresIn: number; tenant: string; user: string }

/**
 * Accepts JSON (fetch from the hydrated form) or a regular form post (works before JavaScript loads, and never puts
 * the password in the URL). Form posts get a 303 redirect; JSON callers get JSON.
 */
// Relative Location: behind a proxy (Azure Container Apps), request.url carries the container's bind address
// (http://0.0.0.0:3000), not the public host, so an absolute redirect built from it would leave the site.
const redirectTo = (path: string) => new Response(null, { status: 303, headers: { Location: path } });

export async function POST(request: Request) {
  const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  let email = "", password = "";
  try {
    if (isForm) {
      const form = await request.formData();
      email = String(form.get("email") ?? "");
      password = String(form.get("password") ?? "");
    } else {
      const body = await request.json();
      email = String(body.email ?? "");
      password = String(body.password ?? "");
    }
  } catch {
    return Response.json({ error: "Invalid sign-in request." }, { status: 400 });
  }
  const fail = (status: number, error: string) =>
    isForm ? redirectTo(`/login?error=${status === 401 ? "credentials" : "unavailable"}`)
      : Response.json({ error }, { status });
  if (!email || !password) return fail(400, "Email and password are required.");
  try {
    const token = await backendJson<TokenResponse>("/v1/auth/token", undefined, {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    (await cookies()).set(SESSION_COOKIE, token.accessToken, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: token.expiresIn,
    });
    return isForm ? redirectTo("/app") : Response.json({ user: token.user, tenant: token.tenant });
  } catch (error) {
    if (error instanceof BackendError) return fail(error.status, error.status === 401 ? "Incorrect email or password." : error.message);
    return fail(502, "The planning service is unreachable.");
  }
}
