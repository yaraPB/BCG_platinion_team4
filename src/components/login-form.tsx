"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

export function LoginForm({ demo = null }: { demo?: { email: string; password: string } | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("demo@viamensa.app");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to sign in.");
      router.push("/app");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
      setPending(false);
    }
  }

  return <form className="login-form" method="post" action="/api/auth/login" onSubmit={submit}>
    <label>Email<input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={pending}><LogIn size={14} />{pending ? "Signing in…" : "Sign in"}</button>
    {demo && <button className="button login-demo" type="button" disabled={pending} onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>Use demo account</button>}
  </form>;
}
