import Link from "next/link";
import { ArrowRight, BrainCircuit, GitFork, Map, ReceiptText, Route, Shuffle } from "lucide-react";

const features = [
  { icon: Map, title: "Your network on the real map", text: "Your suppliers and delivery points connected by OpenStreetMap roads and river legs, with distances measured along the actual route." },
  { icon: Shuffle, title: "Re-plan the moment a road is cut", text: "Close any corridor and every delivery is recalculated: a detour from the same supplier, or the cheapest other supplier that can still reach the community." },
  { icon: GitFork, title: "Knows when the network splits", text: "When a closure cuts the network in two, ViaMensa searches only the side the community is on, then falls back to river or air if no supplier is left there." },
  { icon: BrainCircuit, title: "News-informed risk", text: "When a news alert comes in, an AI analyst maps it to the exact roads it affects and predicts which will close. The network re-plans around them." },
  { icon: Route, title: "Plan B before it happens", text: "Thousands of simulated futures with correlated disruptions give each road its chance of closing and each delivery its outlook, before the cut happens." },
  { icon: ReceiptText, title: "Savings you can audit", text: "Every cost uses a published unit rate with its source, so each saving can be traced back to the figure it came from." },
];

export default function Home() {
  return <div className="landing">
    <header className="landing-header">
      <Link className="brand" href="/" aria-label="ViaMensa home"><span className="brand-mark"><Route size={23} strokeWidth={1.8} /></span><span>ViaMensa<span className="brand-caption">FOOD ACCESS INTELLIGENCE</span></span></Link>
      <nav aria-label="Main navigation"><a href="#features">What it does</a><a href="#how">How it works</a></nav>
      <Link className="button primary sign-in" href="/login">Sign in <ArrowRight size={14} /></Link>
    </header>
    <main>
      <section className="hero">
        <p className="breadcrumb">Routing and fallback planning for food deliveries</p>
        <h1>Keep food moving when roads fail<span>.</span></h1>
        <p className="hero-lead">ViaMensa plans each delivery from your supplier to the community. When a road is cut by flooding, fighting, an accident or anything else, it finds the next best option: a detour, another supplier that can still reach the community, the river, or, only when nothing else is left, air.</p>
        <div className="hero-actions"><Link className="button primary" href="/login">Open your workspace <ArrowRight size={14} /></Link><a className="button" href="#how">See how it works</a></div>
        <p className="hero-fact">Why it matters: WFP South Sudan puts air delivery at about $2,700 per tonne against about $300 by river (<a href="https://x.com/WFP_SouthSudan/status/1755112404088737797" target="_blank" rel="noreferrer">source</a>). A prepared land or river fallback is the difference.</p>
      </section>
      <section id="features" className="feature-grid" aria-label="What ViaMensa does">
        {features.map(({ icon: Icon, title, text }) => <article className="panel feature" key={title}><span className="feature-icon"><Icon size={18} /></span><h3>{title}</h3><p>{text}</p></article>)}
      </section>
      <section id="how" className="how panel">
        <h2>How it works</h2>
        <ol>
          <li><strong>Configure.</strong> Your suppliers, delivery points and caseloads are loaded into your private workspace.</li>
          <li><strong>Plan.</strong> Pick a supplier and a community to get the cheapest itinerary, with cost and travel time for every leg.</li>
          <li><strong>Cut.</strong> Close roads by hand or apply a scenario. ViaMensa re-plans with bidirectional A* for the route and a single reverse search to price every other supplier.</li>
          <li><strong>Anticipate.</strong> A news alert closes the roads it predicts and the network re-plans; the forecast simulates correlated disruptions so fallbacks are ready before they are needed.</li>
          <li><strong>Prove it.</strong> Savings tables compare the fallback with an emergency airlift or with waiting for the road to reopen.</li>
        </ol>
      </section>
    </main>
    <footer className="app-footer landing-footer"><span className="footer-brand">ViaMensa</span><p>Map data © OpenStreetMap contributors. Team 4 · BCG Platinion hackathon.</p></footer>
  </div>;
}
