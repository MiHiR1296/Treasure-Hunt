export const primaryButton = 'min-h-12 w-full rounded-2xl bg-emerald-950 px-5 py-3 font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none';
export const secondaryButton = 'min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-5 py-3 font-bold text-stone-800 transition hover:border-emerald-700 hover:text-emerald-950 disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none';
export const inputStyle = 'mt-2 min-h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-950 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100 disabled:bg-stone-100 disabled:text-stone-500 motion-reduce:transition-none';
export const cardStyle = 'rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-[0_10px_35px_rgba(28,25,23,0.06)] sm:p-7';

export function teamLabel(team: { code: string; displayName: string | null }) {
  return team.displayName ? `${team.code} · ${team.displayName}` : team.code;
}
