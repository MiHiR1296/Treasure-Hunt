'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { calculatePoints, canUseHint, getRemainingPointsAfterHint } from '@/lib/utils/points';
import HintConfirmationDialog from './HintConfirmationDialog';
import Confetti from './Confetti';
import PuzzleStepDisplay from './puzzles/PuzzleStepDisplay';
import PuzzleHintModal from './PuzzleHintModal';
import { PuzzleStep, PuzzleHint } from './puzzles/types';

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
  // Old puzzle chain hints (from puzzle_steps)
  const [puzzleSteps, setPuzzleSteps] = useState<PuzzleStep[]>([]);
  const [completedPuzzleStepIds, setCompletedPuzzleStepIds] = useState<Set<string>>(new Set());
  const [puzzleHintsUsed, setPuzzleHintsUsed] = useState(0); // Track how many puzzle hints have been used
  const [activePuzzleHint, setActivePuzzleHint] = useState<string | null>(null); // Which puzzle hint is currently being shown
  
  // New individual puzzle hints (from puzzle_hints table)
  const [puzzleHints, setPuzzleHints] = useState<PuzzleHint[]>([]);
  const [usedPuzzleHintIds, setUsedPuzzleHintIds] = useState<Set<string>>(new Set());
  const [activePuzzleHintModal, setActivePuzzleHintModal] = useState<PuzzleHint | null>(null);
  
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
    loadPuzzleHints(); // Load individual puzzle hints
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

  // Load individual puzzle hints (from puzzle_hints table)
  const loadPuzzleHints = async () => {
    if (!team) return;

    try {
      const { data: hintsData, error: hintsError } = await supabase
        .from('puzzle_hints')
        .select('*')
        .eq('checkpoint_id', checkpointId)
        .order('hint_slot', { ascending: true });

      if (hintsError) throw hintsError;

      if (hintsData && hintsData.length > 0) {
        setPuzzleHints(hintsData as PuzzleHint[]);

        // Load which puzzle hints have been used (check puzzle_hint_state)
        const { data: stateData } = await supabase
          .from('puzzle_hint_state')
          .select('puzzle_hint_id')
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId)
          .in('puzzle_hint_id', hintsData.map(h => h.id));

        if (stateData) {
          const used = new Set(stateData.map(s => s.puzzle_hint_id));
          setUsedPuzzleHintIds(used);
        } else {
          setUsedPuzzleHintIds(new Set());
        }
      } else {
        setPuzzleHints([]);
        setUsedPuzzleHintIds(new Set());
      }
    } catch (err) {
      console.error('Error loading puzzle hints:', err);
    }
  };

  // Load puzzle steps if puzzles are enabled as hints (old puzzle chain system)
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

  // Handle requesting a puzzle hint (new individual puzzle hints)
  const handleRequestPuzzleHint = (puzzleHint: PuzzleHint) => {
    if (!canUseHint(totalHintsUsed)) {
      return;
    }
    
    // Check if already used
    if (usedPuzzleHintIds.has(puzzleHint.id)) {
      // Already used, just open the modal
      setActivePuzzleHintModal(puzzleHint);
      return;
    }

    // First time use - show confirmation
    setConfirmingHint(`puzzle-hint-${puzzleHint.id}`);
    setShowConfirmation(true);
  };

  // Handle confirming puzzle hint usage (new individual puzzle hints)
  const handleConfirmPuzzleHint = async (puzzleHint: PuzzleHint) => {
    if (!team) return;

    try {
      // Deduct custom points_cost (not checkpoint hint_cost)
      const newHintsUsed = hintsUsed + 1;
      const newPoints = Math.max(0, currentPoints - puzzleHint.points_cost);

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
      
      // Mark as used
      const newUsed = new Set(usedPuzzleHintIds);
      newUsed.add(puzzleHint.id);
      setUsedPuzzleHintIds(newUsed);
      
      // Show the puzzle modal
      setActivePuzzleHintModal(puzzleHint);
      setShowConfirmation(false);
      setConfirmingHint(null);
    } catch (err) {
      console.error('Error using puzzle hint:', err);
    }
  };

  // Handle requesting old puzzle chain hint (for backward compatibility)
  const handleRequestPuzzleChainHint = (stepId: string) => {
    if (!canUseHint(totalHintsUsed)) {
      return;
    }
    setConfirmingHint(`puzzle-${stepId}`); // Prefix to identify as puzzle chain hint
    setShowConfirmation(true);
  };

  // Handle confirming old puzzle chain hint usage
  const handleConfirmPuzzleChainHint = async (stepId: string) => {
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
        // First, load new individual puzzle hints usage
        const { data: puzzleHintStates } = await supabase
          .from('puzzle_hint_state')
          .select('puzzle_hint_id')
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);
        
        const usedPuzzleHintCount = puzzleHintStates?.length || 0;
        
        // Then load old puzzle chain hints if enabled
        let puzzleChainHintsUsed = 0;
        if (usePuzzleChain) {
          const { data: puzzleProgress } = await supabase
            .from('puzzle_progress')
            .select('step_id')
            .eq('team_id', team.id)
            .eq('checkpoint_id', checkpointId);
          
          if (puzzleProgress) {
            const completed = new Set(puzzleProgress.map(p => p.step_id));
            setCompletedPuzzleStepIds(completed);
            puzzleChainHintsUsed = completed.size;
            setPuzzleHintsUsed(completed.size);
          }
        }
        
        // Text hints = total - puzzle hints (new) - puzzle chain hints (old)
        const textHintsUsed = Math.max(0, totalUsed - usedPuzzleHintCount - puzzleChainHintsUsed);
        setHintsUsed(textHintsUsed);
        
        // Restore which text hints were used (approximate based on count)
        setHint1Used(textHintsUsed >= 1);
        setHint2Used(textHintsUsed >= 2);
        setHint3Used(textHintsUsed >= 3);
        
        // Load used puzzle hint IDs
        if (puzzleHintStates) {
          setUsedPuzzleHintIds(new Set(puzzleHintStates.map(s => s.puzzle_hint_id)));
        }
        
        // Use points_earned from database if available (already accounts for all hint costs)
        // Otherwise calculate from base points
        if (progressData.points_earned !== null && progressData.points_earned !== undefined) {
          setCurrentPoints(progressData.points_earned);
        } else {
          // Fallback: calculate current points based on hints used
          // Note: This is approximate - actual calculation happens when hints are used
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

    // Check if it's a new puzzle hint (puzzle-hint-), old puzzle chain hint (puzzle-), or text hint (number)
    if (typeof confirmingHint === 'string' && confirmingHint.startsWith('puzzle-hint-')) {
      // Handle new individual puzzle hint
      const puzzleHintId = confirmingHint.replace('puzzle-hint-', '');
      const puzzleHint = puzzleHints.find(h => h.id === puzzleHintId);
      if (puzzleHint) {
        await handleConfirmPuzzleHint(puzzleHint);
      }
    } else if (typeof confirmingHint === 'string' && confirmingHint.startsWith('puzzle-')) {
      // Handle old puzzle chain hint
      const stepId = confirmingHint.replace('puzzle-', '');
      await handleConfirmPuzzleChainHint(stepId);
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

  // Calculate total hints: text hints + new puzzle hints + old puzzle chain hints
  // All hints count towards the 3 hint limit
  const totalHintsUsed = hintsUsed + usedPuzzleHintIds.size + puzzleHintsUsed;
  const hintsAvailable = 3 - totalHintsUsed;
  
  // Build hint slots (1, 2, 3)
  // Puzzle hints replace text hints in their slots
  const hintSlots: Array<{
    slot: number;
    type: 'text' | 'puzzle-hint' | 'puzzle-chain';
    data: any;
    used: boolean;
  }> = [];

  // Check each slot
  for (let slot = 1; slot <= 3; slot++) {
    // Check if there's a puzzle hint for this slot
    const puzzleHint = puzzleHints.find(h => h.hint_slot === slot);
    if (puzzleHint) {
      hintSlots.push({
        slot,
        type: 'puzzle-hint',
        data: puzzleHint,
        used: usedPuzzleHintIds.has(puzzleHint.id),
      });
    } else {
      // Use text hint for this slot
      const textHint = slot === 1 ? hint1 : slot === 2 ? hint2 : hint3;
      if (textHint) {
        hintSlots.push({
          slot,
          type: 'text',
          data: { id: slot, text: textHint },
          used: slot === 1 ? hint1Used : slot === 2 ? hint2Used : hint3Used,
        });
      }
    }
  }

  // Old puzzle chain hints (shown separately, not in slots)
  const puzzleChainHints = puzzleSteps.map((step) => ({
    id: `puzzle-chain-${step.id}`,
    step: step,
    used: completedPuzzleStepIds.has(step.id),
    type: 'puzzle-chain' as const,
    order: step.step_order,
  }));
  
  const hasHints = hintSlots.length > 0 || puzzleChainHints.length > 0;

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
            Started with {checkpointPoints} points • {checkpointPoints - currentPoints} points deducted for hints
          </p>
        )}
      </div>

      {/* Hints Section - Slot-based hints (text or puzzle hints) */}
      {hasHints && (
        <div className="space-y-3">
          {hintSlots.map((slot) => {
            if (slot.type === 'text') {
              // Text hint
              const hint = slot.data;
              return (
                <div
                  key={`text-${slot.slot}`}
                  className={`border-2 rounded-xl p-4 ${
                    slot.used
                      ? 'bg-yellow-50 border-yellow-300'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">Text Hint {slot.slot}</span>
                        {slot.used && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            Used
                          </span>
                        )}
                      </div>
                      {slot.used ? (
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
                              Use Text Hint {slot.slot} (-{hintCost} pts)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            } else if (slot.type === 'puzzle-hint') {
              // New individual puzzle hint
              const puzzleHint = slot.data as PuzzleHint;
              return (
                <div
                  key={`puzzle-hint-${puzzleHint.id}`}
                  className={`border-2 rounded-xl p-4 ${
                    slot.used
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          🧩 Puzzle Hint {slot.slot}
                          {puzzleHint.title && `: ${puzzleHint.title}`}
                        </span>
                        {slot.used && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            {slot.used ? 'Opened' : 'Available'}
                          </span>
                        )}
                      </div>
                      {puzzleHint.description && (
                        <p className="text-sm text-gray-600 mb-2">{puzzleHint.description}</p>
                      )}
                      <div className="space-y-2">
                        <p className="text-gray-600 text-sm">
                          Solve this puzzle to get a hint. Costs {puzzleHint.points_cost} points.
                        </p>
                        {hintsAvailable > 0 && !slot.used && (
                          <button
                            onClick={() => handleRequestPuzzleHint(puzzleHint)}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors text-sm"
                          >
                            Use Puzzle Hint {slot.slot} (-{puzzleHint.points_cost} pts)
                          </button>
                        )}
                        {slot.used && (
                          <button
                            onClick={() => setActivePuzzleHintModal(puzzleHint)}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors text-sm"
                          >
                            Open Puzzle
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })}

          {/* Old puzzle chain hints (for backward compatibility) */}
          {puzzleChainHints.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-300">
              <p className="text-sm font-semibold text-gray-700 mb-2">Additional Puzzle Hints:</p>
              {puzzleChainHints.map((hint) => (
                <div
                  key={hint.id}
                  className={`border-2 rounded-xl p-4 mb-3 ${
                    hint.used
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          Puzzle Chain Hint {hint.order}
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
                        </div>
                      ) : activePuzzleHint === hint.step.id ? (
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
                              onClick={() => handleRequestPuzzleChainHint(hint.step.id)}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors text-sm"
                            >
                              Use Puzzle Chain Hint {hint.order} (-{hintCost} pts)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

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
          hintCost={
            typeof confirmingHint === 'string' && confirmingHint.startsWith('puzzle-hint-')
              ? puzzleHints.find(h => h.id === confirmingHint.replace('puzzle-hint-', ''))?.points_cost || hintCost
              : hintCost
          }
          onConfirm={handleConfirmHint}
          onCancel={() => {
            setShowConfirmation(false);
            setConfirmingHint(null);
          }}
        />
      )}

      {/* Puzzle Hint Modal */}
      {activePuzzleHintModal && (
        <PuzzleHintModal
          puzzleHint={activePuzzleHintModal}
          checkpointId={checkpointId}
          onClose={() => setActivePuzzleHintModal(null)}
          onPointsUpdate={setCurrentPoints}
        />
      )}
    </div>
  );
}
