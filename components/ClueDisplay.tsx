'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { calculatePoints, canUseHint, getRemainingPointsAfterHint } from '@/lib/utils/points';
import HintConfirmationDialog from './HintConfirmationDialog';
import Confetti from './Confetti';

interface ClueDisplayProps {
  checkpointId: string;
  hint1?: string | null;
  hint2?: string | null;
  hint3?: string | null;
  onNext: () => void;
  checkpointPoints?: number;
}

export default function ClueDisplay({
  checkpointId,
  hint1,
  hint2,
  hint3,
  onNext,
  checkpointPoints = 20,
}: ClueDisplayProps) {
  const [hintsUsed, setHintsUsed] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
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
        // Use points_earned from database if available (already accounts for hints)
        // Otherwise calculate from base points
        if (progressData.points_earned !== null && progressData.points_earned !== undefined) {
          setCurrentPoints(progressData.points_earned);
        } else {
          // Fallback: calculate current points based on hints used
          const points = calculatePoints(checkpointPoints, used);
          setCurrentPoints(points.pointsEarned);
        }
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
    if (!team) return;

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
    console.log('handleComplete called', { team, checkpointId, currentPoints, hintsUsed });
    
    if (!team) {
      console.error('No team found');
      setCompletionError('No team found. Please refresh and try again.');
      return;
    }

    if (isCompleting || showConfetti) {
      console.log('Already completing or completed');
      return;
    }

    setIsCompleting(true);
    setCompletionError(null);

    try {
      console.log('Updating progress in Supabase...');
      
      // Update progress to mark as completed with final points
      const updateData: any = {
        completed_at: new Date().toISOString(),
        points_earned: currentPoints,
        hints_used: hintsUsed,
      };
      
      const { data, error } = await supabase
        .from('progress')
        .update(updateData)
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .select();

      if (error) {
        console.error('Supabase update error:', error);
        throw error;
      }

      console.log('Progress updated successfully:', data);

      // Trigger confetti
      setShowConfetti(true);
      setIsCompleting(false);
      
      // Don't auto-redirect - show success popup and let user click to proceed
      // User will click the button to proceed
    } catch (err: any) {
      console.error('Error completing checkpoint:', err);
      setIsCompleting(false);
      setCompletionError(err.message || 'Failed to complete checkpoint. Please try again.');
      
      // Don't proceed if there's an error - let user retry
    }
  };

  const hintsAvailable = 3 - hintsUsed;
  const hints = [
    { id: 1, text: hint1, used: hintsUsed >= 1 },
    { id: 2, text: hint2, used: hintsUsed >= 2 },
    { id: 3, text: hint3, used: hintsUsed >= 3 },
  ].filter(h => h.text);
  const hasHints = hints.length > 0;

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

      {/* Hints Section */}
      {hasHints && (
        <div className="space-y-3">
          {hints.map((hint, index) => (
            <div
              key={hint.id}
              className={`border-2 rounded-xl p-4 ${
                hint.used
                  ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-900">Hint {hint.id}</span>
                    {hint.used && (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        Used
                      </span>
                    )}
                  </div>
                  {hint.used ? (
                    <p className="text-gray-800">{hint.text}</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-gray-600 text-sm">
                        This hint costs 5 points to reveal.
                      </p>
                      {hintsAvailable > 0 && (
                        <button
                          onClick={handleRequestHint}
                          className="px-4 py-2 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-colors text-sm"
                        >
                          Use Hint {hint.id} (-5 pts)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {hintsAvailable === 0 && (
            <div className="bg-gray-100 border border-gray-300 rounded-xl p-4 text-center">
              <p className="text-gray-600">No hints remaining (3/3 used)</p>
            </div>
          )}
        </div>
      )}

      {!hasHints && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-center">
          <p className="text-blue-800">No hints available for this checkpoint</p>
        </div>
      )}

      {/* Error Message */}
      {completionError && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <p className="text-red-800 font-semibold mb-2">⚠️ Error</p>
          <p className="text-red-700 text-sm">{completionError}</p>
          <button
            onClick={() => setCompletionError(null)}
            className="mt-2 text-red-600 hover:text-red-800 text-sm font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Success Popup - Show when completed */}
      {showConfetti && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center space-y-6">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-3xl font-bold text-gray-900">Checkpoint Completed!</h2>
            <p className="text-lg text-gray-700">
              You earned <span className="font-bold text-indigo-600">{currentPoints} points</span> for this checkpoint!
            </p>
            <button
              onClick={() => {
                setShowConfetti(false);
                onNext();
              }}
              className="w-full bg-green-600 text-white py-4 rounded-lg font-bold text-xl hover:bg-green-700 transition-colors shadow-lg"
            >
              YEA!! 🎉
            </button>
          </div>
        </div>
      )}

      {/* Complete/Next Button - Hidden when completed */}
      {!showConfetti && (
        <div className="space-y-3" style={{ position: 'relative', zIndex: 10 }}>
          <button
            onClick={handleComplete}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors text-lg disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
            disabled={isCompleting || !team}
            type="button"
          >
            {isCompleting ? 'Completing...' : 'Mark as Complete & Next Checkpoint →'}
          </button>
          <p className="text-xs text-gray-500 text-center">
            Click to mark this checkpoint as completed and proceed to the next one
          </p>
        </div>
      )}

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
