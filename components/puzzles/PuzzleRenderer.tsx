'use client';

import { PuzzleStep } from './types';
import TextClue from './TextClue';
import JigsawPuzzle from './JigsawPuzzle';
import SudokuPuzzle from './SudokuPuzzle';
import CrosswordPuzzle from './CrosswordPuzzle';
import WordSearchPuzzle from './WordSearchPuzzle';
import CircularRotatePuzzle from './CircularRotatePuzzle';

interface PuzzleRendererProps {
  step: PuzzleStep;
  onSolved?: () => void;
  initialState?: Record<string, any>;
  onStateChange?: (state: Record<string, any>) => void;
}

export default function PuzzleRenderer({ 
  step, 
  onSolved,
  initialState,
  onStateChange,
}: PuzzleRendererProps) {
  const config = step.puzzle_config || {};

  switch (step.puzzle_type) {
    case 'text':
      // Text puzzle type - use checkpoint hints instead of separate clues
      return (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-6">
          <p className="text-gray-900 text-xl md:text-2xl font-semibold leading-relaxed text-center">
            This is a text puzzle step. Use the checkpoint hints to solve this puzzle.
          </p>
        </div>
      );

    case 'jigsaw':
      if (!step.puzzle_image_url) {
        return <div className="text-red-700 text-lg font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">Error: No image URL provided for jigsaw puzzle</div>;
      }
      return (
        <JigsawPuzzle
          imageUrl={step.puzzle_image_url}
          rows={config.rows || 3}
          columns={config.columns || 3}
          onSolved={onSolved}
          initialState={initialState}
          onStateChange={onStateChange}
        />
      );

    case 'sudoku':
      return (
        <SudokuPuzzle
          grid={config.grid}
          solution={config.solution}
          onSolved={onSolved}
          initialState={initialState}
          onStateChange={onStateChange}
        />
      );

    case 'crossword':
      if (!step.puzzle_image_url) {
        return <div className="text-red-700 text-lg font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">Error: No image URL provided for crossword puzzle</div>;
      }
      return (
        <CrosswordPuzzle
          imageUrl={step.puzzle_image_url}
          answers={config.answers || []}
          onSolved={onSolved}
          initialState={initialState}
          onStateChange={onStateChange}
        />
      );

    case 'word_search':
      if (!step.puzzle_image_url) {
        return <div className="text-red-700 text-lg font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">Error: No image URL provided for word search puzzle</div>;
      }
      return (
        <WordSearchPuzzle
          imageUrl={step.puzzle_image_url}
          words={config.words || []}
          targetWord={config.targetWord}
          showWordsList={config.showWordsList === true}
          onAllWordsFound={onSolved}
          initialState={initialState}
          onStateChange={onStateChange}
        />
      );

    case 'circular_rotate':
      if (!step.puzzle_image_url) {
        return <div className="text-red-700 text-lg font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">Error: No image URL provided for circular rotation puzzle</div>;
      }
      return (
        <CircularRotatePuzzle
          imageUrl={step.puzzle_image_url}
          segments={config.segments || 8}
          correctRotations={config.correctRotation || []}
          onSolved={onSolved}
          initialState={initialState}
          onStateChange={onStateChange}
        />
      );

    default:
      return <div className="text-red-700 text-lg font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">Unknown puzzle type: {step.puzzle_type}</div>;
  }
}
