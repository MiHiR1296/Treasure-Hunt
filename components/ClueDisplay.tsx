'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { calculatePoints, canUseHint, getRemainingPointsAfterHint } from '@/lib/utils/points';
import HintConfirmationDialog from './HintConfirmationDialog';
import Confetti from './Confetti';
import PuzzleStepDisplay from './puzzles/PuzzleStepDisplay';
import { PuzzleStep } from './puzzles/types';

interface ClueDisplayProps {
  checkpointId: string;
  hint1?: string | null;
  hint2?: string | null;
  hint3?: string | null;
  usePuzzleChain?: boolean;
  onNext: () => void;
  checkpointPoints?: number;
  hintCost?: number; // Points deducted per hint (independent system)
}

export default function ClueDisplay({
  checkpointId,
  hint1,
  hint2,
  hint3,
  usePuzzleChain = false,
  onNext,
  checkpointPoints = 20,
  hintCost = 5, // Default to 5 if not provided
}: ClueDisplayProps) {
  // ============================================================================
  // INDEPENDENT SYSTEMS - Clear separation of concerns
  // ============================================================================
  
  // 1. HINT SYSTEM - Independent tracking of hints used
  //    - Tracks text hints and puzzle hints separately
  //    - Does NOT affect completion status
  //    - Only affects points calculation
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hint1Used, setHint1Used] = useState(false);
  const [hint2Used, setHint2Used] = useState(false);
  const [hint3Used, setHint3Used] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmingHint, setConfirmingHint] = useState<number | string | null>(null); // Can be number (text hint) or string (puzzle hint stepId)
  
  // Puzzle hints state (part of hint system)
  const [puzzleSteps, setPuzzleSteps] = useState<PuzzleStep[]>([]);
  const [completedPuzzleStepIds, setCompletedPuzzleStepIds] = useState<Set<string>>(new Set());
  const [puzzleHintsUsed, setPuzzleHintsUsed] = useState(0); // Track how many puzzle hints have been used
  const [activePuzzleHint, setActivePuzzleHint] = useState<string | null>(null); // Which puzzle hint is currently being shown
  
  // 2. POINTS SYSTEM - Independent calculation
  //    - Calculated based on base points and hint deductions
  //    - Does NOT check completion or unlock status
  //    - Only tracks: basePoints - (hintsUsed * hintCost)
  const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
  
  // 3. COMPLETION SYSTEM - Independent verification
  //    - Only checks: unlocked_at !== null (correct QR/code/GPS was verified)
  //    - Does NOT depend on hints or points
  //    - Separate flag: canComplete
  const [canComplete, setCanComplete] = useState(false); // Will be set after verification
  
  // UI State
  const [showConfetti, setShowConfetti] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const { team } = useTeam();

  useEffect(() => {
    loadHintUsage();
    verifyCanComplete();
    if (usePuzzleChain) {
      loadPuzzleSteps();
    }
  }, [checkpointId, team, usePuzzleChain]);

  // Clear flag check: canComplete = unlocked_at !== null
  // This explicitly verifies that the correct QR/code/GPS was given
  // Only when this is true can the user mark the checkpoint as complete
  const verifyCanComplete = async () => {
    if (!team) {
      setCanComplete(false);
      return;
    }

    try {
      const { data: progressData } = await supabase
        .from('progress')
        .select('unlocked_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      // canComplete = unlocked_at !== null (correct QR/code/GPS was verified)
      if (progressData && progressData.unlocked_at !== null) {
        setCanComplete(true);
      } else {
        // Not unlocked yet - this shouldn't happen if parent is correct
        // But be safe and disable completion
        console.warn('ClueDisplay shown but checkpoint not unlocked - disabling completion');
        setCanComplete(false);
      }
    } catch (err) {
      console.error('Error verifying canComplete status:', err);
      // On error, disable completion for safety
      setCanComplete(false);
    }
  };

  // Load puzzle steps if puzzles are enabled as hints
  const loadPuzzleSteps = async () => {
    if (!team) return;

    try {
      const { data: stepsData, error: stepsError } = await supabase
        .from('puzzle_steps')
        .select('*')
        .eq('checkpoint_id', checkpointId)
        .order('step_order', { ascending: true });

      if (stepsError) throw stepsError;

      if (stepsData && stepsData.length > 0) {
        setPuzzleSteps(stepsData as PuzzleStep[]);

        // Load completed puzzle steps
        const { data: progressData } = await supabase
          .from('puzzle_progress')
          .select('step_id')
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);

        if (progressData) {
          const completed = new Set(progressData.map(p => p.step_id));
          setCompletedPuzzleStepIds(completed);
          // Count how many puzzle hints have been used
          setPuzzleHintsUsed(completed.size);
        }
      }
    } catch (err) {
      console.error('Error loading puzzle steps:', err);
    }
  };

  // Handle requesting a puzzle hint
  const handleRequestPuzzleHint = (stepId: string) => {
    if (!canUseHint(totalHintsUsed)) {
      return;
    }
    setConfirmingHint(`puzzle-${stepId}`); // Prefix to identify as puzzle hint
    setShowConfirmation(true);
  };

  // Handle confirming puzzle hint usage
  const handleConfirmPuzzleHint = async (stepId: string) => {
    if (!team) return;

    try {
      // Deduct points (hintCost points per puzzle hint)
      const newHintsUsed = hintsUsed + 1;
      const newPoints = getRemainingPointsAfterHint(currentPoints, hintCost);

      // Update progress with new hints_used and points_earned
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
      
      // Show the puzzle
      setActivePuzzleHint(stepId);
      setShowConfirmation(false);
      setConfirmingHint(null);
    } catch (err) {
      console.error('Error using puzzle hint:', err);
    }
  };

  // Handle puzzle step completion (when puzzle is solved)
  const handlePuzzleStepComplete = async (stepId: string) => {
    if (!team) return;

    try {
      // Check if already completed
      if (completedPuzzleStepIds.has(stepId)) {
        return; // Already solved this puzzle
      }

      // Record puzzle step completion
      await supabase
        .from('puzzle_progress')
        .insert({
          team_id: team.id,
          checkpoint_id: checkpointId,
          step_id: stepId,
        });

      // Update local state
      const newCompleted = new Set(completedPuzzleStepIds);
      newCompleted.add(stepId);
      setCompletedPuzzleStepIds(newCompleted);
      setPuzzleHintsUsed(newCompleted.size);
      
      // Hide the puzzle after solving
      setActivePuzzleHint(null);
    } catch (err) {
      console.error('Error completing puzzle step:', err);
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
        const totalUsed = progressData.hints_used || 0;
        
        // Load puzzle hints separately
        if (usePuzzleChain) {
          const { data: puzzleProgress } = await supabase
            .from('puzzle_progress')
            .select('step_id')
            .eq('team_id', team.id)
            .eq('checkpoint_id', checkpointId);
          
          if (puzzleProgress) {
            const completed = new Set(puzzleProgress.map(p => p.step_id));
            setCompletedPuzzleStepIds(completed);
            setPuzzleHintsUsed(completed.size);
            
            // Text hints = total - puzzle hints
            const textHintsUsed = Math.max(0, totalUsed - completed.size);
            setHintsUsed(textHintsUsed);
            
            // Restore which text hints were used (approximate based on count)
            setHint1Used(textHintsUsed >= 1);
            setHint2Used(textHintsUsed >= 2);
            setHint3Used(textHintsUsed >= 3);
          } else {
            // No puzzle hints, all are text hints
            setHintsUsed(totalUsed);
            setHint1Used(totalUsed >= 1);
            setHint2Used(totalUsed >= 2);
            setHint3Used(totalUsed >= 3);
          }
        } else {
          // No puzzle chain, all hints are text hints
          setHintsUsed(totalUsed);
          setHint1Used(totalUsed >= 1);
          setHint2Used(totalUsed >= 2);
          setHint3Used(totalUsed >= 3);
        }
        
        // Use points_earned from database if available (already accounts for hints)
        // Otherwise calculate from base points
        if (progressData.points_earned !== null && progressData.points_earned !== undefined) {
          setCurrentPoints(progressData.points_earned);
        } else {
          // Fallback: calculate current points based on hints used
          const points = calculatePoints(checkpointPoints, totalUsed, hintCost);
          setCurrentPoints(points.pointsEarned);
        }
      } else {
        // No progress yet, use defaults
        setHintsUsed(0);
        setHint1Used(false);
        setHint2Used(false);
        setHint3Used(false);
        setPuzzleHintsUsed(0);
        setCurrentPoints(checkpointPoints);
      }
    } catch (err) {
      console.error('Error loading hint usage:', err);
      // No progress yet, use defaults
      setHintsUsed(0);
      setHint1Used(false);
      setHint2Used(false);
      setHint3Used(false);
      setPuzzleHintsUsed(0);
      setCurrentPoints(checkpointPoints);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestHint = (hintNumber: number) => {
    if (!canUseHint(totalHintsUsed)) {
      return;
    }
    setConfirmingHint(hintNumber);
    setShowConfirmation(true);
  };

  const handleConfirmHint = async () => {
    if (!team || confirmingHint === null) return;

    // Check if it's a puzzle hint (string starting with 'puzzle-') or text hint (number)
    if (typeof confirmingHint === 'string' && confirmingHint.startsWith('puzzle-')) {
      // Handle puzzle hint
      const stepId = confirmingHint.replace('puzzle-', '');
      await handleConfirmPuzzleHint(stepId);
    } else {
      // Handle text hint
      const hintNumber = confirmingHint as number;
      try {
        const newHintsUsed = hintsUsed + 1;
        const newPoints = getRemainingPointsAfterHint(currentPoints, hintCost);

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
        if (hintNumber === 1) setHint1Used(true);
        if (hintNumber === 2) setHint2Used(true);
        if (hintNumber === 3) setHint3Used(true);
        
        setShowConfirmation(false);
        setConfirmingHint(null);
      } catch (err) {
        console.error('Error using hint:', err);
      }
    }
  };

  // ============================================================================
  // COMPLETION SYSTEM - Independent from hints and points
  // ============================================================================
  // This function ONLY checks if checkpoint can be completed (unlocked_at !== null)
  // It does NOT depend on hints used or points earned
  // Points are saved separately and independently
  const handleComplete = async () => {
    console.log('handleComplete called', { team, checkpointId, currentPoints, totalHintsUsed });
    
    if (!team) {
      console.error('No team found');
      setCompletionError('No team found. Please refresh and try again.');
      return;
    }

    if (isCompleting || showConfetti) {
      console.log('Already completing or completed');
      return;
    }

    // COMPLETION CHECK: canComplete must be true (unlocked_at !== null)
    // This is INDEPENDENT of hints or points
    // Only verifies that the correct QR/code/GPS was given
    if (!canComplete) {
      console.error('Cannot complete: Checkpoint not verified (canComplete is false)');
      setCompletionError('You must unlock this checkpoint first by scanning the correct QR code, entering the correct code, or reaching the GPS location.');
      return;
    }

    // Additional verification: Double-check in database
    // COMPLETION SYSTEM ONLY - checks unlocked_at and completed_at
    try {
      const { data: progressCheck } = await supabase
        .from('progress')
        .select('unlocked_at, completed_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      // Prevent double completion
      if (progressCheck && progressCheck.completed_at !== null) {
        console.log('Checkpoint already completed');
        setShowConfetti(true);
        return;
      }

      // Final security check: Must have unlocked_at !== null
      // This is the ONLY requirement for completion
      if (!progressCheck || progressCheck.unlocked_at === null) {
        console.error('Security check failed: unlocked_at is null');
        setCompletionError('Unable to verify checkpoint unlock status. Please refresh the page and try again.');
        return;
      }
    } catch (err) {
      console.error('Error verifying completion status:', err);
      setCompletionError('Unable to verify checkpoint status. Please try again.');
      return;
    }

    setIsCompleting(true);
    setCompletionError(null);

    try {
      console.log('Updating progress in Supabase...');
      
      // Update progress to mark as completed
      // INDEPENDENT SYSTEMS: Save completion, points, and hints separately
      // - completed_at: Completion system (independent)
      // - points_earned: Points system (independent, calculated from hints)
      // - hints_used: Hint system (independent tracking)
      const updateData: any = {
        completed_at: new Date().toISOString(), // COMPLETION SYSTEM
        points_earned: currentPoints, // POINTS SYSTEM (independent calculation)
        hints_used: totalHintsUsed, // HINT SYSTEM (independent tracking)
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

  // Calculate total hints: text hints + puzzle hints
  // Puzzle hints count towards the 3 hint limit
  const totalHintsUsed = hintsUsed + puzzleHintsUsed;
  const hintsAvailable = 3 - totalHintsUsed;
  
  const textHints = [
    { id: 1, text: hint1, used: hint1Used, type: 'text' as const },
    { id: 2, text: hint2, used: hint2Used, type: 'text' as const },
    { id: 3, text: hint3, used: hint3Used, type: 'text' as const },
  ].filter(h => h.text);
  
  // Puzzle hints (each puzzle step is a hint)
  const puzzleHints = puzzleSteps.map((step, index) => ({
    id: `puzzle-${step.id}`,
    step: step,
    used: completedPuzzleStepIds.has(step.id),
    type: 'puzzle' as const,
    order: step.step_order,
  }));
  
  // Combine all hints (text + puzzle) and sort by order
  const allHints = [
    ...textHints.map(h => ({ ...h, order: h.id })),
    ...puzzleHints,
  ].sort((a, b) => {
    if (a.type === 'text' && b.type === 'text') return a.id - b.id;
    if (a.type === 'puzzle' && b.type === 'puzzle') return a.order - b.order;
    // Text hints come first, then puzzles
    return a.type === 'text' ? -1 : 1;
  });
  
  const hasHints = textHints.length > 0 || puzzleHints.length > 0;

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
          {totalHintsUsed > 0 && (
            <div className="text-right">
              <p className="text-sm opacity-90">Hints used</p>
              <p className="text-2xl font-bold">{totalHintsUsed} / 3</p>
            </div>
          )}
        </div>
        {currentPoints < checkpointPoints && (
          <p className="text-xs mt-2 opacity-75">
            Started with {checkpointPoints} points • {totalHintsUsed * hintCost} points deducted for hints
          </p>
        )}
      </div>

      {/* Hints Section - Text Hints and Puzzle Hints */}
      {hasHints && (
        <div className="space-y-3">
          {allHints.map((hint) => {
            if (hint.type === 'text') {
              // Text hint
              return (
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
                        <span className="font-semibold text-gray-900">Text Hint {hint.id}</span>
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
                            This hint costs {hintCost} points to reveal.
                          </p>
                          {hintsAvailable > 0 && (
                            <button
                              onClick={() => handleRequestHint(hint.id)}
                              className="px-4 py-2 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-colors text-sm"
                            >
                              Use Text Hint {hint.id} (-{hintCost} pts)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            } else {
              // Puzzle hint
              return (
                <div
                  key={hint.id}
                  className={`border-2 rounded-xl p-4 ${
                    hint.used
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          Puzzle Hint {hint.order}
                          {hint.step.title && `: ${hint.step.title}`}
                        </span>
                        {hint.used && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            Solved
                          </span>
                        )}
                      </div>
                      {hint.step.description && (
                        <p className="text-sm text-gray-600 mb-2">{hint.step.description}</p>
                      )}
                      {hint.used ? (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-green-800 text-sm font-semibold">✓ Puzzle completed!</p>
                          <p className="text-green-700 text-xs mt-1">This puzzle hint has been solved.</p>
                        </div>
                      ) : activePuzzleHint === hint.step.id ? (
                        // Show puzzle when active
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-2">
                          <PuzzleStepDisplay
                            step={hint.step}
                            stepNumber={hint.order}
                            totalSteps={puzzleSteps.length}
                            onStepComplete={() => handlePuzzleStepComplete(hint.step.id)}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-gray-600 text-sm">
                            Solve this puzzle to get a hint. Costs {hintCost} points.
                          </p>
                          {hintsAvailable > 0 && (
                            <button
                              onClick={() => handleRequestPuzzleHint(hint.step.id)}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors text-sm"
                            >
                              Use Puzzle Hint {hint.order} (-{hintCost} pts)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
          })}

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

      {/* Complete/Next Button - Only shown when canComplete is true (correct QR/code/GPS verified) */}
      {!showConfetti && (
        <div className="space-y-3" style={{ position: 'relative', zIndex: 10 }}>
          {canComplete ? (
            <>
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
            </>
          ) : (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 text-center">
              <p className="text-yellow-800 font-semibold">
                ⚠️ You must unlock this checkpoint first
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Scan the correct QR code, enter the correct code, or reach the GPS location to unlock
              </p>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmation && confirmingHint !== null && (
        <HintConfirmationDialog
          currentPoints={currentPoints}
          hintsUsed={totalHintsUsed}
          hintsAvailable={hintsAvailable}
          hintCost={hintCost}
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
