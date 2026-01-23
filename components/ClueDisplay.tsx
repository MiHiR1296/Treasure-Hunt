'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { calculatePoints, canUseHint, getRemainingPointsAfterHint } from '@/lib/utils/points';
import HintConfirmationDialog from './HintConfirmationDialog';
import Confetti from './Confetti';

interface ClueDisplayProps {
  checkpointId: string;
  hintText?: string | null;
  onNext: () => void;
  checkpointPoints?: number;
}

export default function ClueDisplay({
  checkpointId,
  hintText,
  onNext,
  checkpointPoints = 20,
}: ClueDisplayProps) {
  const [hintsUsed, setHintsUsed] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
  const [showConfetti, setShowConfetti] = useState(false);
  const { team } = useTeam();

  useEffect(() => {
    loadHintUsage();
  }, [checkpointId, team]);

  const loadHintUsage = async () => {
    if (!team) return;

    try {
      const { data: progressData } = await supabase
        .from('progress')
        .select('hints_used, points_earned')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .single();

      if (progressData) {
        const used = progressData.hints_used || 0;
        setHintsUsed(used);
        // Calculate current points based on hints used
        const points = calculatePoints(checkpointPoints, used);
        setCurrentPoints(points.pointsEarned);
      }
    } catch (err) {
      // No progress yet, use default
    }
  };

  const handleRequestHint = () => {
    if (!canUseHint(hintsUsed)) {
      return;
    }
    setShowConfirmation(true);
  };

  const handleConfirmHint = async () => {
    if (!team || !hintText) return;

    try {
      const newHintsUsed = hintsUsed + 1;
      const newPoints = getRemainingPointsAfterHint(currentPoints);

      // Update progress
      await supabase
        .from('progress')
        .update({
          hints_used: newHintsUsed,
          points_earned: newPoints,
        })
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId);

      setHintsUsed(newHintsUsed);
      setCurrentPoints(newPoints);
      setShowHint(true);
      setShowConfirmation(false);
    } catch (err) {
      console.error('Error using hint:', err);
    }
  };

  const handleComplete = async () => {
    if (!team) return;

    try {
      // Update progress to mark as completed with final points
      await supabase
        .from('progress')
        .update({
          completed_at: new Date().toISOString(),
          points_earned: currentPoints,
          hints_used: hintsUsed,
        })
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId);

      // Trigger confetti
      setShowConfetti(true);
      // Call onNext after a short delay to show confetti
      setTimeout(() => {
        onNext();
      }, 2000);
    } catch (err) {
      console.error('Error completing checkpoint:', err);
      // Still proceed even if update fails
      setShowConfetti(true);
      setTimeout(() => {
        onNext();
      }, 2000);
    }
  };

  const hintsAvailable = 3 - hintsUsed;
  const pointsCalculation = calculatePoints(checkpointPoints, hintsUsed);

  return (
    <div className="w-full space-y-6">
      <Confetti trigger={showConfetti} />

      {/* Points Display */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-90">Points for this checkpoint</p>
            <p className="text-3xl font-bold">{currentPoints}</p>
          </div>
          {hintsUsed > 0 && (
            <div className="text-right">
              <p className="text-sm opacity-90">Hints used</p>
              <p className="text-2xl font-bold">{hintsUsed} / 3</p>
            </div>
          )}
        </div>
        {currentPoints < checkpointPoints && (
          <p className="text-xs mt-2 opacity-75">
            Started with {checkpointPoints} points • {hintsUsed * 5} points deducted for hints
          </p>
        )}
      </div>

      {/* Hint Section - Always show if hintText exists */}
      {hintText && (
        <>
          {hintsAvailable > 0 && !showHint && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-yellow-900 mb-1">
                    💡 Need a Hint?
                  </p>
                  <p className="text-sm text-yellow-700">
                    {hintsAvailable} hint{hintsAvailable !== 1 ? 's' : ''} available
                  </p>
                </div>
                <button
                  onClick={handleRequestHint}
                  className="px-4 py-2 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-colors"
                >
                  Use Hint (-5 pts)
                </button>
              </div>
            </div>
          )}

          {showHint && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6">
              <h4 className="text-lg font-semibold text-yellow-900 mb-2">💡 Hint:</h4>
              <p className="text-yellow-800">{hintText}</p>
            </div>
          )}

          {hintsAvailable === 0 && !showHint && hintText && (
            <div className="bg-gray-100 border border-gray-300 rounded-xl p-4 text-center">
              <p className="text-gray-600">No hints remaining (3/3 used)</p>
            </div>
          )}
        </>
      )}

      {!hintText && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-center">
          <p className="text-blue-800">No hints available for this checkpoint</p>
        </div>
      )}

      {/* Complete/Next Button - Always visible */}
      <div className="space-y-3">
        <button
          onClick={handleComplete}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={showConfetti}
        >
          {showConfetti ? 'Completing...' : 'Mark as Complete & Next Checkpoint →'}
        </button>
        <p className="text-xs text-gray-500 text-center">
          Click to mark this checkpoint as completed and proceed to the next one
        </p>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <HintConfirmationDialog
          currentPoints={currentPoints}
          hintsUsed={hintsUsed}
          hintsAvailable={hintsAvailable}
          onConfirm={handleConfirmHint}
          onCancel={() => setShowConfirmation(false)}
        />
      )}
    </div>
  );
}
