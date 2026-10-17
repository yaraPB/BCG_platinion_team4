"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="empty-page"><h1>Unable to load the control tower</h1><p>Please try again to reload the planning view.</p><button className="button" onClick={reset}>Try again</button></main>;
}
