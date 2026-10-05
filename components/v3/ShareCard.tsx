'use client';

import { useEffect, useMemo, useState } from 'react';
import type { VisibleRecognitionResult } from './types';
import { secondaryButton } from './ui';

interface ShareCardProps {
  huntTitle: string;
  teamLabel: string;
  memberName: string;
  score: number;
  rank?: number;
  runNumber: number;
  elapsedLabel?: string;
  result?: VisibleRecognitionResult | null;
  organizerHandle?: string;
  campaignHashtag?: string;
  publicBoardSlug?: string;
  allowPersonalTitle?: boolean;
}

function splitLines(context: CanvasRenderingContext2D, value: string, maximumWidth: number) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maximumWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function fillWrapped(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight: number, maximumLines = 4) {
  const lines = splitLines(context, value, width).slice(0, maximumLines);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function storyBlob(props: ShareCardProps, includePersonalTitle: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create an image.');

  const gradient = context.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, '#062f28');
  gradient.addColorStop(0.55, '#0b513f');
  gradient.addColorStop(1, '#322064');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1920);

  context.fillStyle = 'rgba(255,255,255,0.08)';
  context.beginPath(); context.arc(940, 230, 310, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(90, 1720, 420, 0, Math.PI * 2); context.fill();

  context.fillStyle = '#d1fae5';
  context.font = '700 34px Arial, sans-serif';
  context.fillText('TREASURE HUNT · RUN COMPLETE', 90, 130);
  context.fillStyle = '#ffffff';
  context.font = '900 82px Arial, sans-serif';
  let y = fillWrapped(context, props.huntTitle, 90, 255, 900, 92, 3) + 80;

  context.fillStyle = 'rgba(255,255,255,0.12)';
  roundedRect(context, 70, y, 940, 650, 48); context.fill();
  context.fillStyle = '#a7f3d0';
  context.font = '700 31px Arial, sans-serif';
  context.fillText(props.teamLabel.toUpperCase(), 125, y + 95);
  context.fillStyle = '#ffffff';
  context.font = '900 225px Arial, sans-serif';
  context.fillText(String(props.score), 115, y + 330);
  context.font = '700 42px Arial, sans-serif';
  context.fillStyle = '#d1fae5';
  context.fillText('POINTS', 125, y + 395);

  context.fillStyle = '#ffffff';
  context.font = '800 43px Arial, sans-serif';
  const facts = [`RUN ${props.runNumber}`, props.rank ? `RANK #${props.rank}` : '', props.elapsedLabel ? `TIME ${props.elapsedLabel}` : ''].filter(Boolean);
  context.fillText(facts.join('  ·  '), 125, y + 500);

  if (includePersonalTitle && props.result) {
    y += 730;
    context.fillStyle = '#ddd6fe';
    context.font = '700 29px Arial, sans-serif';
    context.fillText(`${props.memberName.toUpperCase()}'S CREW TITLE`, 90, y);
    context.fillStyle = '#ffffff';
    context.font = '900 68px Arial, sans-serif';
    fillWrapped(context, props.result.headlineTitle, 90, y + 95, 900, 76, 3);
  }

  const footer = [props.organizerHandle, props.campaignHashtag].filter(Boolean).join('  ·  ');
  context.fillStyle = '#d1fae5';
  context.font = '700 32px Arial, sans-serif';
  if (footer) context.fillText(footer, 90, 1775);
  context.fillStyle = 'rgba(255,255,255,0.78)';
  context.font = '500 25px Arial, sans-serif';
  context.fillText('Made for the trail. Shared by the crew.', 90, 1840);

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The story image could not be created.')), 'image/png'));
}

function fallbackCopy(value: string) {
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy was blocked.');
}

export default function ShareCard(props: ShareCardProps) {
  const [includeTitle, setIncludeTitle] = useState(false);
  const [busy, setBusy] = useState<'share' | 'download' | 'copy' | null>(null);
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState(props.publicBoardSlug ? `/board/${encodeURIComponent(props.publicBoardSlug)}` : '');
  useEffect(() => {
    setShareUrl(props.publicBoardSlug ? `${window.location.origin}/board/${encodeURIComponent(props.publicBoardSlug)}` : window.location.href);
  }, [props.publicBoardSlug]);
  const caption = useMemo(() => {
    const pieces = [
      `${props.teamLabel} finished ${props.huntTitle} with ${props.score} points${props.rank ? ` at rank #${props.rank}` : ''}.`,
      `Run ${props.runNumber}${props.elapsedLabel ? ` · ${props.elapsedLabel}` : ''}.`,
      includeTitle && props.result ? `${props.memberName}: ${props.result.headlineTitle}.` : '',
      props.organizerHandle ? `Thanks ${props.organizerHandle}!` : '',
      props.campaignHashtag || '',
    ];
    return pieces.filter(Boolean).join(' ');
  }, [includeTitle, props]);

  const createFile = async () => new File([await storyBlob(props, includeTitle)], `treasure-hunt-${props.runNumber}.png`, { type: 'image/png' });
  const share = async () => {
    setBusy('share'); setMessage('');
    try {
      if (!navigator.share) throw new Error('Sharing is not available in this browser. Use Download image or Copy caption below.');
      const file = await createFile();
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: props.huntTitle, text: caption, url: shareUrl, files: [file] });
      else await navigator.share({ title: props.huntTitle, text: caption, url: shareUrl });
      setMessage('Share sheet opened. You choose where the result goes.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setMessage('Share cancelled. Your result is still here.');
      else setMessage(error instanceof Error ? error.message : 'Sharing was unavailable. Download the card instead.');
    } finally { setBusy(null); }
  };
  const download = async () => {
    setBusy('download'); setMessage('');
    try {
      const blob = await storyBlob(props, includeTitle);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `treasure-hunt-run-${props.runNumber}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Story card downloaded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The image could not be downloaded.'); }
    finally { setBusy(null); }
  };
  const copy = async () => {
    setBusy('copy'); setMessage('');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(`${caption} ${shareUrl}`);
      else fallbackCopy(`${caption} ${shareUrl}`);
      setMessage('Caption copied.');
    } catch { setMessage('Copy was blocked. Select the caption below and copy it manually.'); }
    finally { setBusy(null); }
  };

  return <section className="rounded-[1.75rem] bg-gradient-to-br from-emerald-950 to-violet-950 p-5 text-white shadow-xl sm:p-7" aria-labelledby="share-result-heading">
    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-200">Your story card</p>
    <h2 id="share-result-heading" className="mt-1 text-2xl font-black tracking-tight">Take the finish with you</h2>
    <p className="mt-3 text-sm leading-relaxed text-emerald-50/80">Share opens your phone’s native share sheet. You choose Instagram yourself—a browser cannot auto-post or guarantee a tag.</p>
    {props.result && props.allowPersonalTitle !== false && <label className="mt-5 flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold"><input type="checkbox" checked={includeTitle} onChange={event => setIncludeTitle(event.target.checked)} className="h-5 w-5 accent-emerald-400" /> Include my private title: {props.result.headlineTitle}</label>}
    <div className="mt-5 grid gap-2 sm:grid-cols-3">
      <button type="button" disabled={busy !== null} onClick={() => void share()} className="min-h-12 rounded-2xl bg-white px-4 py-3 font-bold text-emerald-950 disabled:opacity-50">{busy === 'share' ? 'Opening…' : 'Share story'}</button>
      <button type="button" disabled={busy !== null} onClick={() => void download()} className="min-h-12 rounded-2xl border border-white/40 px-4 py-3 font-bold text-white disabled:opacity-50">{busy === 'download' ? 'Making…' : 'Download image'}</button>
      <button type="button" disabled={busy !== null} onClick={() => void copy()} className="min-h-12 rounded-2xl border border-white/40 px-4 py-3 font-bold text-white disabled:opacity-50">{busy === 'copy' ? 'Copying…' : 'Copy caption'}</button>
    </div>
    <p aria-live="polite" className="mt-3 min-h-5 text-xs text-emerald-100">{message}</p>
    <details className="mt-2 text-xs text-emerald-50/75"><summary className="min-h-10 cursor-pointer py-2 font-bold">Preview caption</summary><p className="select-all rounded-xl bg-black/20 p-3 leading-relaxed">{caption} {shareUrl}</p></details>
    {(props.organizerHandle || props.campaignHashtag) && <p className="mt-4 text-sm font-bold text-emerald-200">Remember to tag {props.organizerHandle || 'the organizer'} {props.campaignHashtag ? `and add ${props.campaignHashtag}` : ''}.</p>}
  </section>;
}
