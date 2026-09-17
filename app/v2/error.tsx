'use client';

/** Reload also clears a failed lazy-import promise; resetting React alone does not. */
export default function AdventureError() {
  return <main className="min-h-screen bg-[#f5f3ed] px-4 py-12 text-stone-900">
    <section className="mx-auto max-w-xl space-y-5 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
      <p className="text-sm font-semibold text-emerald-800">Treasure Hunt</p>
      <h1 className="text-2xl font-bold leading-tight">This part of the adventure could not open.</h1>
      <p role="alert" className="leading-relaxed">Check your connection, then reload this page.</p>
      <p className="leading-relaxed text-stone-600">Saved hunt and team progress remain on the event server. Reloading reconnects you to your current task.</p>
      <button type="button" onClick={() => window.location.reload()} className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">Reload page</button>
      <p className="text-sm leading-relaxed text-stone-600">If it still will not open, contact your organizer for help.</p>
    </section>
  </main>;
}
