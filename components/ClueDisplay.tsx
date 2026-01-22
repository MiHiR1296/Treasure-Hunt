'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

interface ClueDisplayProps {
  checkpointId: string;
  clueText: string;
  hintText?: string | null;
  onNext: () => void;
}

export default function ClueDisplay({
  checkpointId,
  clueText,
  hintText,
  onNext,
}: ClueDisplayProps) {
  const [showHint, setShowHint] = useState(false);
  const [hintRequested, setHintRequested] = useState(false);
  const { team } = useTeam();

  const handleRequestHint = async () => {
    if (!team || !hintText || hintRequested) return;

    try {
      // Record hint request
      await supabase.from('hint_requests').insert({
        team_id: team.id,
        checkpoint_id: checkpointId,
      });

      // Update progress to increment hints_used
      await supabase
        .from('progress')
        .update({ hints_used: 1 })
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId);

      setShowHint(true);
      setHintRequested(true);
    } catch (err) {
      console.error('Error requesting hint:', err);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Your Clue:</h3>
        <p className="text-gray-800 text-lg leading-relaxed whitespace-pre-line">
          {clueText}
        </p>
      </div>

      {hintText && !showHint && (
        <button
          onClick={handleRequestHint}
          disabled={hintRequested}
          className="w-full bg-yellow-500 text-white py-3 rounded-lg font-semibold hover:bg-yellow-600 transition-colors disabled:opacity-50"
        >
          💡 Need a Hint?
        </button>
      )}

      {showHint && hintText && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h4 className="text-md font-semibold text-yellow-900 mb-2">💡 Hint:</h4>
          <p className="text-yellow-800">{hintText}</p>
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors"
      >
        I've Solved It - Show Next Checkpoint
      </button>
    </div>
  );
}
