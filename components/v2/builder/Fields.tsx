'use client';

import { cloneElement, isValidElement, useId, type ReactNode } from 'react';

export const inputClass = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:opacity-50';
export const buttonClass = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
export const actionClass = 'min-h-11 rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-40';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const generatedId = useId();
  const child = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? children : null;
  const id = child?.props.id || generatedId;
  return <div className="space-y-1.5"><label htmlFor={id} className="block text-sm font-semibold text-slate-700">{label}</label>{child ? cloneElement(child, { id, ...(hint ? { 'aria-describedby': id + '-help' } : {}) }) : children}{hint && <p id={id + '-help'} className="text-xs leading-5 text-slate-500">{hint}</p>}</div>;
}

export function TextField({ label, value, onChange, multiline = false, hint, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; hint?: string; placeholder?: string; type?: string;
}) {
  return <Field label={label} hint={hint}>{multiline
    ? <textarea className={inputClass} rows={3} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    : <input className={inputClass} type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}</Field>;
}

export function NumberField({ label, value, onChange, min, max, step = 1, hint }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number | 'any'; hint?: string;
}) {
  return <Field label={label} hint={hint}><input className={inputClass} type="number" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} /></Field>;
}

export function CheckField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700"><input type="checkbox" className="h-5 w-5 accent-teal-800" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export function LocationFields({ value, onChange, accuracy = false }: {
  value: { latitude: number; longitude: number; radiusMeters?: number; maxAccuracyMeters?: number };
  onChange: (value: { latitude: number; longitude: number; radiusMeters?: number; maxAccuracyMeters?: number }) => void;
  accuracy?: boolean;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <NumberField label="Latitude" value={value.latitude} step="any" min={-90} max={90} onChange={latitude => onChange({ ...value, latitude })} />
    <NumberField label="Longitude" value={value.longitude} step="any" min={-180} max={180} onChange={longitude => onChange({ ...value, longitude })} />
    {value.radiusMeters !== undefined && <NumberField label="Search radius (metres)" value={value.radiusMeters} min={1} max={100000} onChange={radiusMeters => onChange({ ...value, radiusMeters })} />}
    {accuracy && <NumberField label="Maximum reading uncertainty (metres)" value={value.maxAccuracyMeters ?? 100} min={1} max={100000} onChange={maxAccuracyMeters => onChange({ ...value, maxAccuracyMeters })} hint="Larger values accept less precise phone readings. GPS confirms an area, not an exact landmark." />}
  </div>;
}
