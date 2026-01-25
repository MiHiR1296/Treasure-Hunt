'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { calculatePoints, canUseHint, getRemainingPointsAfterHint } from '@/lib/utils/points';
import HintConfirmationDialog from './HintConfirmationDialog';

interface HintsModalProps {
  checkpointId: string;
  hint1?: string | null;
  hint2?: string | null;
  hint3?: string | null;
  checkpointPoints: number;
  hintCost?: number; // Points deducted per hint (default: 5)
  onClose: () => void;
  onPointsUpdate?: (newPoints: number) => void;
}

export default function HintsModal({
  checkpointId,
  hint1,
  hint2,
  hint3,
  checkpointPoints,
  hintCost = 5, // Default to 5 if not provided
  onClose,
  onPointsUpdate,
}: HintsModalProps) {
  // State flags - clear separation
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hint1Used, setHint1Used] = useState(false);
  const [hint2Used, setHint2Used] = useState(false);
  const [hint3Used, setHint3Used] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmingHint, setConfirmingHint] = useState<number | null>(null);
  const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
  const [isLoading, setIsLoading] = useState(true);
  const { team } = useTeam();

  const hints = [
    { id: 1, text: hint1, used: hint1Used, setUsed: setHint1Used },
    { id: 2, text: hint2, used: hint2Used, setUsed: setHint2Used },
    { id: 3, text: hint3, used: hint3Used, setUsed: setHint3Used },
  ].filter(h => h.text); // Only show hints that exist

  useEffect(() => {
    loadHintUsage();
  }, [checkpointId, team]);

  const loadHintUsage = async () => {
    if (!team) {
      setIsLoading(false);
      return;
    }

    try {
      const { data: progressData } = await supabase
        .from('progress')
        .select('hints_used, points_earned')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      if (progressData) {
        const used = progressData.hints_used || 0;
        setHintsUsed(used);
        
        // Restore which specific hints were used based on count
        // If hints_used >= 1, hint 1 was used
        // If hints_used >= 2, hint 2 was used
        // If hints_used >= 3, hint 3 was used
        setHint1Used(used >= 1);
        setHint2Used(used >= 2);
        setHint3Used(used >= 3);
        
        // Use points_earned from DB if available, otherwise calculate
        let pointsToSet: number;
        if (progressData.points_earned !== null && progressData.points_earned !== undefined) {
          pointsToSet = progressData.points_earned;
        } else {
          const points = calculatePoints(checkpointPoints, used, hintCost);
          pointsToSet = points.pointsEarned;
        }
        setCurrentPoints(pointsToSet);
        
        // Sync points to parent component
        if (onPointsUpdate) {
          onPointsUpdate(pointsToSet);
        }
      } else {
        // No progress yet - reset to defaults
        setHintsUsed(0);
        setHint1Used(false);
        setHint2Used(false);
        setHint3Used(false);
        setCurrentPoints(checkpointPoints);
        
        // Sync points to parent component
        if (onPointsUpdate) {
          onPointsUpdate(checkpointPoints);
        }
      }
    } catch (err) {
      console.error('Error loading hint usage:', err);
      // No progress yet - reset to defaults
      setHintsUsed(0);
      setHint1Used(false);
      setHint2Used(false);
      setHint3Used(false);
      setCurrentPoints(checkpointPoints);
      
      // Sync points to parent component
      if (onPointsUpdate) {
        onPointsUpdate(checkpointPoints);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestHint = (hintNumber: number) => {
    if (!canUseHint(hintsUsed)) {
      return;
    }
    setConfirmingHint(hintNumber);
    setShowConfirmation(true);
  };

  const handleConfirmHint = async () => {
    if (!team || confirmingHint === null) return;

    const hintToShow = hints.find(h => h.id === confirmingHint);
    if (!hintToShow || !hintToShow.text) return;

    try {
      const newHintsUsed = hintsUsed + 1;
        const newPoints = getRemainingPointsAfterHint(currentPoints, hintCost);

      // Check if progress exists
      const { data: existingProgress } = await supabase
        .from('progress')
        .select('id')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      if (existingProgress) {
        // Update existing progress
        await supabase
          .from('progress')
          .update({
            hints_used: newHintsUsed,
            points_earned: newPoints,
          })
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);
      } else {
        // Create progress record if it doesn't exist (hints used before unlocking)
        await supabase
          .from('progress')
          .upsert({
            team_id: team.id,
            checkpoint_id: checkpointId,
            hints_used: newHintsUsed,
            points_earned: newPoints,
            unlocked_at: null, // Not unlocked yet
            completed_at: null,
          }, {
            onConflict: 'team_id,checkpoint_id',
          });
      }

      // Update local state
      setHintsUsed(newHintsUsed);
      setCurrentPoints(newPoints);
      hintToShow.setUsed(true); // Mark this specific hint as used
      setShowConfirmation(false);
      setConfirmingHint(null);

      // Sync points to parent component
      if (onPointsUpdate) {
        onPointsUpdate(newPoints);
      }
    } catch (err) {
      console.error('Error using hint:', err);
    }
  };

  const hintsAvailable = 3 - hintsUsed;

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-gray-600">Loading hints...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Hints for This Checkpoint</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
            >
              ×
            </button>
          </div>

          {/* Points Display */}
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-4 text-white mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Current Points</p>
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
                Started with {checkpointPoints} points • {hintsUsed * hintCost} points deducted
              </p>
            )}
          </div>

          {/* Hints List */}
          <div className="space-y-4">
            {hints.map((hint) => (
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
                      <span className="text-lg font-semibold text-gray-900">
                        Hint {hint.id}
                      </span>
                      {hint.used && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          Revealed
                        </span>
                      )}
                    </div>
                    {hint.used ? (
                      <p className="text-gray-800">{hint.text}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-gray-600 text-sm">
                          This hint costs {hintCost} points to reveal.
                        </p>
                        <button
                          onClick={() => handleRequestHint(hint.id)}
                          disabled={!canUseHint(hintsUsed) || hintsAvailable === 0}
                          className="px-4 py-2 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Use Hint {hint.id} (-{hintCost} pts)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {hints.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No hints available for this checkpoint.</p>
              </div>
            )}

            {hintsAvailable === 0 && (
              <div className="bg-gray-100 border border-gray-300 rounded-xl p-4 text-center">
                <p className="text-gray-600">All hints have been used (3/3)</p>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && confirmingHint !== null && (
        <HintConfirmationDialog
          currentPoints={currentPoints}
          hintsUsed={hintsUsed}
          hintsAvailable={hintsAvailable}
          hintCost={hintCost}
          onConfirm={handleConfirmHint}
          onCancel={() => {
            setShowConfirmation(false);
            setConfirmingHint(null);
          }}
        />
      )}
    </>
  );
}
