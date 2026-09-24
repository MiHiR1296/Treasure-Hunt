'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import QRScanner from '@/components/QRScanner';
import type { Feedback, GameCommand, PlayerNode } from '@/lib/engine/types';
import { savedDraft, storeDraft } from './sessionClient';
import MediaContent from './player/MediaContent';
import ActionFeedback, { type ActionNotice } from './player/ActionFeedback';
const PuzzlePlayer = dynamic(() => import('./puzzles/PuzzlePlayer'));
const CameraGuide = dynamic(() => import('./player/CameraGuide'), { ssr: false });
const PhotoVerification = dynamic(() => import('./player/PhotoVerification'), { ssr: false });

export type SendCommand = (command: GameCommand) => Promise<Feedback | null>;
export const primaryButton = 'hunt-action min-h-12 w-full rounded-xl bg-[var(--hunt-primary,#065f46)] px-5 py-3 font-semibold text-[var(--hunt-on-primary,#ffffff)] transition-shadow motion-reduce:transition-none hover:shadow-md disabled:cursor-wait disabled:opacity-50';
export const inputStyle = 'mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100';

function TaskCopy({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  return <div className="space-y-3 text-lg leading-relaxed text-stone-700">
    {blocks.map((block, index) => <p key={index} className="whitespace-pre-line">{block}</p>)}
  </div>;
}

export default function CurrentTask({ teamId, checkpointId, node, disabled, send, notice, clearNotice }: {
  teamId: string; checkpointId: string; node: PlayerNode; disabled: boolean; send: SendCommand; notice?: ActionNotice | null; clearNotice?: () => void;
}) {
  const draftKey = `${teamId}:${checkpointId}:${node.id}:answer`;
  const [answer, setAnswer] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const draft = savedDraft<string>(draftKey);
    if (typeof draft === 'string') setAnswer(draft);
    return () => { mounted.current = false; };
  }, [draftKey]);
  const address = { checkpointId, nodeId: node.id };
  const hasAnswer = node.type === 'verify_answer' || node.type === 'verify_code' || (node.type === 'verify_qr' && node.backupCodeEnabled);
  const submitAnswer = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !answer.trim()) return;
    const result = await send({ type: 'verify', ...address, value: answer });
    if (result?.status === 'accepted') storeDraft(draftKey, null);
  };
  const locate = () => {
    if (disabled || locating) return;
    if (!navigator.geolocation) { setLocationMessage('This browser cannot check your location. Ask your organizer for help.'); return; }
    setLocating(true);
    setLocationMessage('Finding your location. Stay still in an open area.');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (!mounted.current) return;
      setLocationMessage(`Location accuracy: about ${Math.round(coords.accuracy)} metres.`);
      await send({ type: 'verify_gps', ...address, location: { latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy } });
      if (mounted.current) setLocating(false);
    }, (error) => {
      if (!mounted.current) return;
      setLocating(false);
      setLocationMessage(error.code === 1 ? 'Location permission is blocked. Enable it in your browser settings and try again, or use Need help below.' : 'We could not get a reliable location. Move to an open area and retry, use an available fallback, or ask your organizer for help.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  return <div className="space-y-6">
    {node.type === 'show_text' ? <TaskCopy text={node.text} /> : 'prompt' in node ? <TaskCopy text={node.prompt} /> : null}
    {node.type === 'show_media' && <MediaContent content={node.content} />}
    {(node.type === 'show_text' || node.type === 'show_media') && <button type="button" disabled={disabled} onClick={() => void send({ type: 'continue', ...address })} className={primaryButton}>Continue</button>}
    {node.type === 'verify_qr' && <div className="hunt-qr-actions"><QRScanner onScanSuccess={async (value) => {
      if (disabled) return { accepted: false, message: 'Wait for your last action, or use Retry to check it.' };
      const feedback = await send({ type: 'verify', ...address, value });
      return { accepted: feedback?.scannerShouldStop === true, message: feedback?.message || 'Connection interrupted. Use Retry to check this same code.' };
    }} /></div>}
    {hasAnswer && <form onSubmit={submitAnswer} className="space-y-4">
      <label className="block text-sm font-semibold text-stone-700" htmlFor="task-answer">{node.type === 'verify_answer' ? 'Your answer' : node.type === 'verify_qr' ? 'Have a backup code?' : 'Your code'}
        <input id="task-answer" value={answer} onChange={event => { setAnswer(event.target.value); storeDraft(draftKey, event.target.value); clearNotice?.(); }} readOnly={disabled} aria-invalid={notice?.kind === 'error' || undefined} aria-describedby={notice?.id} maxLength={2000} autoComplete="off" autoCapitalize="none" className={inputStyle} required />
      </label>
      <ActionFeedback notice={notice} />
      <button type="submit" disabled={disabled || !answer.trim()} className={primaryButton}>{node.type === 'verify_answer' ? 'Check answer' : 'Check code'}</button>
    </form>}
    {node.type === 'verify_gps' && <div className="space-y-3"><p className="text-sm leading-relaxed text-stone-600">Your approximate location is checked only when you tap the button.</p><button type="button" disabled={disabled || locating} onClick={locate} className={primaryButton}>{locating ? 'Checking location…' : 'I’m here — check location'}</button>{locationMessage && <p role="status" className="text-sm leading-relaxed text-stone-600">{locationMessage}</p>}</div>}
    {node.type === 'choose_path' && <div className="space-y-3">{node.choices.map(choice => <button type="button" key={choice.id} disabled={disabled} className={primaryButton} onClick={() => void send({ type: 'choose_path', ...address, choiceId: choice.id })}>{choice.label}</button>)}</div>}
    {node.type === 'puzzle' && <PuzzlePlayer definition={node.puzzle} state={node.progress.state} feedback={notice} clearFeedback={clearNotice} draftKey={`${teamId}:${checkpointId}:${node.id}:puzzle:${node.progress.revision}`} disabled={disabled} onChange={async value => {
      const result = await send({ type: 'submit_puzzle', ...address, expectedRevision: node.progress.revision, value });
      if (!result) throw new Error('Puzzle move needs confirmation.');
    }} />}
    {node.type === 'camera_guide' && <><CameraGuide description="Use the camera and reference to recognize your landmark." referenceImageUrl={node.referenceImageUrl} latitude={node.latitude} longitude={node.longitude} /><button type="button" disabled={disabled} onClick={() => void send({ type: 'continue', ...address })} className={primaryButton}>Continue after finding the landmark</button></>}
    {node.type === 'verify_image' && <PhotoVerification teamId={teamId} checkpointId={checkpointId} node={node} disabled={disabled} send={send} />}
    {node.type === 'verify_organizer' && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm leading-relaxed">Your organizer needs to approve this step. Use Need help below to let them know you are ready. Your team will continue here after approval.</p>}
    {!hasAnswer && <ActionFeedback notice={notice} />}
    {node.fallback?.enabled && <button type="button" disabled={disabled} className="hunt-action min-h-12 w-full rounded-xl border border-emerald-800 px-4 py-3 font-semibold text-emerald-900 disabled:opacity-50" onClick={() => void send({ type: 'use_fallback', ...address })}>{node.fallback.label || 'Try another way'}</button>}
  </div>;
}
