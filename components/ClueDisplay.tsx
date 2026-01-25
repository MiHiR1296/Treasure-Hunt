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
  // State flags - clear separation
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hint1Used, setHint1Used] = useState(false);
  const [hint2Used, setHint2Used] = useState(false);
  const [hint3Used, setHint3Used] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmingHint, setConfirmingHint] = useState<number | null>(null);
  const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false); // Track unlock status for security
  const { team } = useTeam();

  useEffect(() => {
    loadHintUsage();
    verifyUnlockStatus();
  }, [checkpointId, team]);

  // Security: Verify checkpoint is unlocked before showing completion button
  const verifyUnlockStatus = async () => {
    if (!team) return;

    try {
      const { data: progressData } = await supabase
        .from('progress')
        .select('unlocked_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      // Set unlock status - this component should only be shown when unlocked
      if (progressData && progressData.unlocked_at !== null) {
        setIsUnlocked(true);
      } else {
        console.warn('ClueDisplay shown but checkpoint not unlocked - this should not happen');
        setIsUnlocked(false);
      }
    } catch (err) {
      console.error('Error verifying unlock status:', err);
      setIsUnlocked(false);
    }
  };

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
        setHint1Used(used >= 1);
        setHint2Used(used >= 2);
        setHint3Used(used >= 3);
        
        // Use points_earned from database if available (already accounts for hints)
        // Otherwise calculate from base points
        if (progressData.points_earned !== null && progressData.points_earned !== undefined) {
          setCurrentPoints(progressData.points_earned);
        } else {
          // Fallback: calculate current points based on hints used
          const points = calculatePoints(checkpointPoints, used);
          setCurrentPoints(points.pointsEarned);
        }
      } else {
        // No progress yet, use defaults
        setHintsUsed(0);
        setHint1Used(false);
        setHint2Used(false);
        setHint3Used(false);
        setCurrentPoints(checkpointPoints);
      }
    } catch (err) {
      console.error('Error loading hint usage:', err);
      // No progress yet, use defaults
      setHintsUsed(0);
      setHint1Used(false);
      setHint2Used(false);
      setHint3Used(false);
      setCurrentPoints(checkpointPoints);
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

      // Update local state
      setHintsUsed(newHintsUsed);
      setCurrentPoints(newPoints);
      
      // Mark the specific hint as used
      if (confirmingHint === 1) setHint1Used(true);
      if (confirmingHint === 2) setHint2Used(true);
      if (confirmingHint === 3) setHint3Used(true);
      
      setShowConfirmation(false);
      setConfirmingHint(null);
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

    // Security check: Verify checkpoint is actually unlocked before allowing completion
    try {
      const { data: progressCheck } = await supabase
        .from('progress')
        .select('unlocked_at, completed_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      // Must be unlocked (unlocked_at !== null) to complete
      if (!progressCheck || progressCheck.unlocked_at === null) {
        console.error('Cannot complete: Checkpoint not unlocked');
        setCompletionError('You must unlock this checkpoint first by scanning the QR code, entering the code, or reaching the GPS location.');
        return;
      }

      // Prevent double completion
      if (progressCheck.completed_at !== null) {
        console.log('Checkpoint already completed');
        setShowConfetti(true);
        return;
      }
    } catch (err) {
      console.error('Error verifying unlock status:', err);
      setCompletionError('Unable to verify checkpoint status. Please try again.');
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
    { id: 1, text: hint1, used: hint1Used },
    { id: 2, text: hint2, used: hint2Used },
    { id: 3, text: hint3, used: hint3Used },
  ].filter(h => h.text);
  const hasHints = hints.length > 0;

  if (isLoading) {
    return (
      <div className="w-full space-y-6">
        <div className="bg-gray-100 rounded-xl p-8 text-center">
          <p className="text-gray-600">Loading hints...</p>
        </div>
      </div>
    );
  }

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
                          onClick={() => handleRequestHint(hint.id)}
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

      {/* Complete/Next Button - Hidden when completed, disabled if not unlocked */}
      {!showConfetti && (
        <div className="space-y-3" style={{ position: 'relative', zIndex: 10 }}>
          <button
            onClick={handleComplete}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors text-lg disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
            disabled={isCompleting || !team || !isUnlocked}
            type="button"
          >
            {isCompleting ? 'Completing...' : 'Mark as Complete & Next Checkpoint →'}
          </button>
          {!isUnlocked && (
            <p className="text-xs text-red-600 text-center font-semibold">
              ⚠️ You must unlock this checkpoint first before marking it as complete
            </p>
          )}
          {isUnlocked && (
            <p className="text-xs text-gray-500 text-center">
              Click to mark this checkpoint as completed and proceed to the next one
            </p>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmation && confirmingHint !== null && (
        <HintConfirmationDialog
          currentPoints={currentPoints}
          hintsUsed={hintsUsed}
          hintsAvailable={hintsAvailable}
          onConfirm={handleConfirmHint}
          onCancel={() => {
            setShowConfirmation(false);
            setConfirmingHint(null);
          }}
        />
      )}
    </div>
  );
}
