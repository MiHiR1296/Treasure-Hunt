'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { PuzzleStep } from './types';
import PuzzleStepDisplay from './PuzzleStepDisplay';

interface PuzzleChainRendererProps {
  checkpointId: string;
  onComplete: () => void;
}

export default function PuzzleChainRenderer({ checkpointId, onComplete }: PuzzleChainRendererProps) {
  const { team } = useTeam();
  const [steps, setSteps] = useState<PuzzleStep[]>([]);
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(new Set());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (team) {
      loadPuzzleChain();
    }
  }, [team, checkpointId]);

  const loadPuzzleChain = async () => {
    try {
      setIsLoading(true);
      setError('');

      // Load puzzle steps
      const { data: stepsData, error: stepsError } = await supabase
        .from('puzzle_steps')
        .select('*')
        .eq('checkpoint_id', checkpointId)
        .order('step_order', { ascending: true });

      if (stepsError) throw stepsError;

      if (!stepsData || stepsData.length === 0) {
        setError('No puzzle steps found for this checkpoint');
        setIsLoading(false);
        return;
      }

      setSteps(stepsData as PuzzleStep[]);

      // Load completed steps
      if (team) {
        const { data: progressData, error: progressError } = await supabase
          .from('puzzle_progress')
          .select('step_id')
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);

        if (progressError) throw progressError;

        const completed = new Set(progressData?.map(p => p.step_id) || []);
        setCompletedStepIds(completed);

        // Find first incomplete step
        const firstIncompleteIndex = stepsData.findIndex(
          (step) => !completed.has(step.id)
        );
        setCurrentStepIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : stepsData.length - 1);
      }
    } catch (err: any) {
      console.error('Error loading puzzle chain:', err);
      setError(err.message || 'Failed to load puzzle chain');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStepComplete = async () => {
    if (!team) return;

    const currentStep = steps[currentStepIndex];
    if (!currentStep) return;

    // Check if step is already completed
    if (completedStepIds.has(currentStep.id)) {
      // Step already completed - show friendly message
      setError('');
      // Don't throw error, just return - the UI will show completion state
      return;
    }

    try {
      // Check if step is already in database
      const { data: existingProgress } = await supabase
        .from('puzzle_progress')
        .select('step_id')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .eq('step_id', currentStep.id)
        .maybeSingle();

      if (existingProgress) {
        // Already completed - update local state and proceed
        const newCompleted = new Set(completedStepIds);
        newCompleted.add(currentStep.id);
        setCompletedStepIds(newCompleted);
        
        // Move to next step or show completion message
        if (currentStepIndex === steps.length - 1) {
          // Last step already completed
          return;
        } else {
          setCurrentStepIndex(currentStepIndex + 1);
        }
        return;
      }

      // Record step completion
      const { error: progressError } = await supabase
        .from('puzzle_progress')
        .insert({
          team_id: team.id,
          checkpoint_id: checkpointId,
          step_id: currentStep.id,
        });

      if (progressError) {
        // If it's a duplicate key error, that's okay - step was already completed
        if (progressError.code === '23505') {
          // Duplicate key - step already completed
          const newCompleted = new Set(completedStepIds);
          newCompleted.add(currentStep.id);
          setCompletedStepIds(newCompleted);
          
          if (currentStepIndex === steps.length - 1) {
            return;
          } else {
            setCurrentStepIndex(currentStepIndex + 1);
          }
          return;
        }
        throw progressError;
      }

      // Update local state
      const newCompleted = new Set(completedStepIds);
      newCompleted.add(currentStep.id);
      setCompletedStepIds(newCompleted);

      // Check if this is the last step
      if (currentStepIndex === steps.length - 1) {
        // Puzzles are complete - but checkpoint is NOT complete yet
        // User still needs to unlock the checkpoint (scan QR, enter code, etc.)
        // and then complete it via the ClueDisplay component
        // Don't set completed_at or points_earned here - that's only for checkpoint completion
        // Just show success message that puzzles are done
      } else {
        // Move to next step
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (err: any) {
      console.error('Error completing step:', err);
      // Show friendly error message instead of technical error
      if (err.code === '23505') {
        setError('This puzzle step has already been completed. Please proceed to unlock the checkpoint.');
      } else {
        setError(err.message || 'Failed to complete step');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-600">Loading puzzle chain...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        {error}
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
        No puzzle steps configured for this checkpoint.
      </div>
    );
  }

  const currentStep = steps[currentStepIndex];

  if (!currentStep) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        Invalid step index
      </div>
    );
  }

  const isLastStep = currentStepIndex === steps.length - 1;
  const allStepsCompleted = completedStepIds.size === steps.length;

  return (
    <div className="w-full">
      <PuzzleStepDisplay
        step={currentStep}
        stepNumber={currentStepIndex + 1}
        totalSteps={steps.length}
        onStepComplete={handleStepComplete}
      />
      
      {/* Show completion message when all puzzle steps are done */}
      {allStepsCompleted && isLastStep && (
        <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="text-4xl">✅</div>
            <div>
              <p className="text-blue-900 font-bold text-xl">
                All Puzzles Completed!
              </p>
              <p className="text-blue-700 text-sm mt-1">
                Great work! You've completed all puzzle steps. These puzzles help you find the checkpoint location.
              </p>
              <p className="text-blue-600 text-sm mt-2 font-semibold">
                Now unlock the checkpoint by scanning the QR code or entering the answer above.
              </p>
            </div>
          </div>
          <p className="text-xs text-blue-600 text-center">
            Note: Completing puzzles does not complete the checkpoint. You still need to unlock and complete it.
          </p>
        </div>
      )}
    </div>
  );
}
