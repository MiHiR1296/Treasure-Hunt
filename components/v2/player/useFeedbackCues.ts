'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const preferenceKey = 'hunt-v2-success-sound';
interface PlayingNote { oscillator: OscillatorNode; gain: GainNode }
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Opt-in local sound. Call unlock() synchronously in the action's user gesture. */
export function useFeedbackCues() {
  const [soundEnabled, setEnabled] = useState(false);
  const enabled = useRef(false);
  const mounted = useRef(true);
  const context = useRef<AudioContext | null>(null);
  const notes = useRef(new Set<PlayingNote>());
  const lastPlayedAt = useRef(-Infinity);

  const stopNotes = useCallback(() => {
    for (const note of notes.current) {
      note.oscillator.onended = null;
      try { note.oscillator.stop(); } catch { /* A completed tone is already stopped. */ }
      try { note.oscillator.disconnect(); note.gain.disconnect(); } catch { /* Context may have closed. */ }
    }
    notes.current.clear();
  }, []);

  const dispose = useCallback(() => {
    stopNotes();
    const audio = context.current;
    context.current = null;
    lastPlayedAt.current = -Infinity;
    try { if (audio && audio.state !== 'closed') void audio.close().catch(() => {}); }
    catch { /* Some browsers can close the device before cleanup runs. */ }
  }, [stopNotes]);

  useEffect(() => {
    mounted.current = true;
    try { enabled.current = localStorage.getItem(preferenceKey) === '1'; setEnabled(enabled.current); }
    catch { /* Sound remains off when preferences cannot be read. */ }
    return () => { mounted.current = false; dispose(); };
  }, [dispose]);

  const unlock = useCallback(() => {
    if (!mounted.current || !enabled.current || typeof window === 'undefined') return;
    // Audio setup belongs to a real tap/click, never an API response or poll.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try {
      const Audio = window.AudioContext || (window as AudioWindow).webkitAudioContext;
      if (!Audio) return;
      if (!context.current || context.current.state === 'closed') context.current = new Audio({ latencyHint: 'interactive' });
      if (context.current.state !== 'running') void context.current.resume().catch(() => {});
    } catch { /* Unsupported or denied audio never blocks gameplay. */ }
  }, []);

  const setSoundEnabled = useCallback((value: boolean) => {
    if (!mounted.current) return;
    enabled.current = value;
    setEnabled(value);
    try { localStorage.setItem(preferenceKey, value ? '1' : '0'); } catch { /* Preference still works for this visit. */ }
    if (value) unlock(); else dispose();
  }, [dispose, unlock]);

  const toggleSound = useCallback(() => setSoundEnabled(!enabled.current), [setSoundEnabled]);

  const playSuccess = useCallback(() => {
    const audio = context.current;
    if (!mounted.current || !enabled.current || !audio || audio.state !== 'running') return;
    if (audio.currentTime - lastPlayedAt.current < 0.3) return;
    lastPlayedAt.current = audio.currentTime;
    try {
      for (const [index, frequency] of [523.25, 659.25].entries()) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const note = { oscillator, gain };
        const start = audio.currentTime + 0.01 + index * 0.1;
        const end = start + (index === 0 ? 0.13 : 0.17);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(index === 0 ? 0.028 : 0.024, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain); gain.connect(audio.destination);
        notes.current.add(note);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); notes.current.delete(note); };
        oscillator.start(start); oscillator.stop(end + 0.01);
      }
    } catch { stopNotes(); }
  }, [stopNotes]);

  return { soundEnabled, setSoundEnabled, toggleSound, unlock, playSuccess };
}

export default useFeedbackCues;
