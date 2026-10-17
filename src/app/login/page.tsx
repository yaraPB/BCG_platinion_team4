import Link from "next/link";
import { Route } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; error?: string }> }) {
  const { expired, error } = await searchParams;
  // Opt-in demo shortcut: only shown when the server is configured with the demo credentials (never bundled).
  const demoPassword = process.env.VIAMENSA_DEMO_PASSWORD;
  const demo = demoPassword ? { email: process.env.VIAMENSA_DEMO_EMAIL ?? "demo@viamensa.app", password: demoPassword } : null;
  return <main className="login-page">
    <Link className="brand" href="/" aria-label="ViaMensa home"><span className="brand-mark"><Route size={23} strokeWidth={1.8} /></span><span>ViaMensa<span className="brand-caption">FOOD ACCESS INTELLIGENCE</span></span></Link>
    <section className="panel login-card">
      <h1>Sign in<span>.</span></h1>
      <p className="muted">Your client workspace: your network, scenarios and simulations.</p>
      {expired && <p className="error-banner" role="alert">Your session expired. Please sign in again.</p>}
      {error && <p className="error-banner" role="alert">{error === "credentials" ? "Incorrect email or password." : "The planning service is unavailable. Try again shortly."}</p>}
      <LoginForm demo={demo} />
    </section>
  </main>;
}
