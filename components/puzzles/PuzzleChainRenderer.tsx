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

    try {
      // Record step completion
      const { error: progressError } = await supabase
        .from('puzzle_progress')
        .insert({
          team_id: team.id,
          checkpoint_id: checkpointId,
          step_id: currentStep.id,
        });

      if (progressError) throw progressError;

      // Update local state
      const newCompleted = new Set(completedStepIds);
      newCompleted.add(currentStep.id);
      setCompletedStepIds(newCompleted);

      // Check if this is the last step
      if (currentStepIndex === steps.length - 1) {
        // Mark checkpoint as completed
        const { error: checkpointError } = await supabase
          .from('progress')
          .update({ completed_at: new Date().toISOString() })
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);

        if (checkpointError) throw checkpointError;

        // Call completion callback
        onComplete();
      } else {
        // Move to next step
        setCurrentStepIndex(currentStepIndex + 1);
      }
    } catch (err: any) {
      console.error('Error completing step:', err);
      setError(err.message || 'Failed to complete step');
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

  return (
    <div className="w-full">
      <PuzzleStepDisplay
        step={currentStep}
        stepNumber={currentStepIndex + 1}
        totalSteps={steps.length}
        onStepComplete={handleStepComplete}
      />
    </div>
  );
}
