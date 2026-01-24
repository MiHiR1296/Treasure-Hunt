'use client';

import { useState, useEffect } from 'react';
import { PuzzleType, AnswerType } from './types';

export interface PuzzleStepConfig {
  id: string;
  step_order: number;
  puzzle_type: PuzzleType;
  puzzle_config: Record<string, any>;
  puzzle_image_url: string | null;
  answer_type: AnswerType;
  answer_value: string;
  title: string;
  description: string;
  imageFile?: File | null;
}

interface PuzzleChainBuilderProps {
  steps: PuzzleStepConfig[];
  onChange: (steps: PuzzleStepConfig[]) => void;
  checkpointId?: string;
}

export default function PuzzleChainBuilder({ steps, onChange, checkpointId }: PuzzleChainBuilderProps) {
  const addStep = () => {
    const newStep: PuzzleStepConfig = {
      id: `step-${Date.now()}`,
      step_order: steps.length + 1,
      puzzle_type: 'text',
      puzzle_config: {},
      puzzle_image_url: null,
      answer_type: 'text',
      answer_value: '',
      title: '',
      description: '',
      imageFile: null,
    };
    onChange([...steps, newStep]);
  };

  const removeStep = (id: string) => {
    const newSteps = steps
      .filter(s => s.id !== id)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));
    onChange(newSteps);
  };

  const updateStep = (id: string, updates: Partial<PuzzleStepConfig>) => {
    const newSteps = steps.map(s => 
      s.id === id ? { ...s, ...updates } : s
    );
    onChange(newSteps);
  };

  const moveStep = (id: string, direction: 'up' | 'down') => {
    const index = steps.findIndex(s => s.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    newSteps.forEach((s, idx) => { s.step_order = idx + 1; });
    onChange(newSteps);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Puzzle Steps ({steps.length})</h3>
        <button
          type="button"
          onClick={addStep}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Step
        </button>
      </div>

      {steps.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-gray-600">No puzzle steps yet. Click "Add Step" to create one.</p>
        </div>
      )}

      <div className="space-y-4">
        {steps.map((step, index) => (
          <PuzzleStepEditor
            key={step.id}
            step={step}
            stepNumber={index + 1}
            totalSteps={steps.length}
            onUpdate={(updates) => updateStep(step.id, updates)}
            onRemove={() => removeStep(step.id)}
            onMoveUp={index > 0 ? () => moveStep(step.id, 'up') : undefined}
            onMoveDown={index < steps.length - 1 ? () => moveStep(step.id, 'down') : undefined}
            checkpointId={checkpointId}
          />
        ))}
      </div>
    </div>
  );
}

interface PuzzleStepEditorProps {
  step: PuzzleStepConfig;
  stepNumber: number;
  totalSteps: number;
  onUpdate: (updates: Partial<PuzzleStepConfig>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  checkpointId?: string;
}

function PuzzleStepEditor({
  step,
  stepNumber,
  totalSteps,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  checkpointId,
}: PuzzleStepEditorProps) {
  // Show answer section only if answer_value is set
  const [showAnswer, setShowAnswer] = useState(!!(step.answer_value && step.answer_value.trim() !== ''));
  
  useEffect(() => {
    // Update showAnswer when step changes
    setShowAnswer(!!(step.answer_value && step.answer_value.trim() !== ''));
  }, [step.answer_value]);
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpdate({ imageFile: file });
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        onUpdate({ puzzle_image_url: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const renderPuzzleConfig = () => {
    switch (step.puzzle_type) {
      case 'text':
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              Text puzzle type. The checkpoint hints will be used instead of separate clues.
            </p>
          </div>
        );

      case 'jigsaw':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Puzzle Image:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              />
              {step.puzzle_image_url && (
                <img src={step.puzzle_image_url} alt="Preview" className="mt-2 max-w-xs rounded-lg" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rows:
                </label>
                <input
                  type="number"
                  min="2"
                  max="6"
                  value={step.puzzle_config.rows || 3}
                  onChange={(e) => onUpdate({
                    puzzle_config: { ...step.puzzle_config, rows: parseInt(e.target.value) || 3 },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Columns:
                </label>
                <input
                  type="number"
                  min="2"
                  max="6"
                  value={step.puzzle_config.columns || 3}
                  onChange={(e) => onUpdate({
                    puzzle_config: { ...step.puzzle_config, columns: parseInt(e.target.value) || 3 },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                />
              </div>
            </div>
          </div>
        );

      case 'sudoku':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Solution (9x9 grid, comma-separated, 0 for empty):
              </label>
              <textarea
                value={step.puzzle_config.solution || ''}
                onChange={(e) => {
                  const solution = e.target.value.split(',').map(n => parseInt(n.trim()) || 0);
                  onUpdate({ puzzle_config: { ...step.puzzle_config, solution } });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                rows={3}
                placeholder="1,2,3,4,5,6,7,8,9,..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter 81 numbers (9 rows × 9 columns) separated by commas
              </p>
            </div>
          </div>
        );

      case 'crossword':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Crossword Image:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              />
              {step.puzzle_image_url && (
                <img src={step.puzzle_image_url} alt="Preview" className="mt-2 max-w-xs rounded-lg" />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Answers (comma-separated):
              </label>
              <input
                type="text"
                value={step.puzzle_config.answers?.join(',') || ''}
                onChange={(e) => {
                  const answers = e.target.value.split(',').map(a => a.trim()).filter(Boolean);
                  onUpdate({ puzzle_config: { ...step.puzzle_config, answers } });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                placeholder="Answer1, Answer2, Answer3"
              />
            </div>
          </div>
        );

      case 'word_search':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Word Search Image:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              />
              {step.puzzle_image_url && (
                <img src={step.puzzle_image_url} alt="Preview" className="mt-2 max-w-xs rounded-lg" />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Words to Find (comma-separated):
              </label>
              <input
                type="text"
                value={step.puzzle_config.words?.join(',') || ''}
                onChange={(e) => {
                  const words = e.target.value.split(',').map(w => w.trim()).filter(Boolean);
                  onUpdate({ puzzle_config: { ...step.puzzle_config, words } });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                placeholder="WORD1, WORD2, WORD3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Word (the clue word):
              </label>
              <input
                type="text"
                value={step.puzzle_config.targetWord || ''}
                onChange={(e) => onUpdate({
                  puzzle_config: { ...step.puzzle_config, targetWord: e.target.value },
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                placeholder="CLUE"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`showWordsList-${step.id}`}
                checked={step.puzzle_config.showWordsList !== false}
                onChange={(e) => onUpdate({
                  puzzle_config: { ...step.puzzle_config, showWordsList: e.target.checked },
                })}
                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
              />
              <label htmlFor={`showWordsList-${step.id}`} className="text-sm font-medium text-gray-700 cursor-pointer">
                Show words list to players
              </label>
            </div>
          </div>
        );

      case 'circular_rotate':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Image (1:1 ratio recommended):
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              />
              {step.puzzle_image_url && (
                <img src={step.puzzle_image_url} alt="Preview" className="mt-2 max-w-xs rounded-lg" />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Number of Segments:
              </label>
              <input
                type="number"
                min="4"
                max="16"
                value={step.puzzle_config.segments || 8}
                onChange={(e) => onUpdate({
                  puzzle_config: { ...step.puzzle_config, segments: parseInt(e.target.value) || 8 },
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Correct Rotations (comma-separated degrees):
              </label>
              <input
                type="text"
                value={step.puzzle_config.correctRotation?.join(',') || ''}
                onChange={(e) => {
                  const rotations = e.target.value.split(',').map(r => parseInt(r.trim()) || 0);
                  onUpdate({ puzzle_config: { ...step.puzzle_config, correctRotation: rotations } });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                placeholder="0, 90, 180, 270, ..."
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="border-2 border-gray-300 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">Step {stepNumber}</span>
          <span className="text-sm text-gray-500">({step.puzzle_type})</span>
        </div>
        <div className="flex gap-2">
          {onMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
            >
              ↑
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
            >
              ↓
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="px-2 py-1 text-sm bg-red-200 text-red-700 rounded hover:bg-red-300"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Step Title (optional):
            </label>
            <input
              type="text"
              value={step.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
              placeholder="Step title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Puzzle Type:
            </label>
            <select
              value={step.puzzle_type}
              onChange={(e) => onUpdate({
                puzzle_type: e.target.value as PuzzleType,
                puzzle_config: {},
                puzzle_image_url: null,
                imageFile: null,
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white"
            >
              <option value="text">Text Clue</option>
              <option value="jigsaw">Jigsaw Puzzle</option>
              <option value="sudoku">Sudoku</option>
              <option value="crossword">Crossword</option>
              <option value="word_search">Word Search</option>
              <option value="circular_rotate">Circular Rotate</option>
            </select>
          </div>
        </div>

        {renderPuzzleConfig()}

        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              id={`showAnswer-${step.id}`}
              checked={showAnswer}
              onChange={(e) => {
                setShowAnswer(e.target.checked);
                if (!e.target.checked) {
                  // Clear answer when hiding
                  onUpdate({ answer_value: '', answer_type: 'text' });
                }
              }}
              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
            />
            <label htmlFor={`showAnswer-${step.id}`} className="text-sm font-medium text-gray-700 cursor-pointer">
              Require answer validation for this step
            </label>
          </div>

          {showAnswer && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Answer Type:
                </label>
                <select
                  value={step.answer_type}
                  onChange={(e) => onUpdate({ answer_type: e.target.value as AnswerType })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                >
                  <option value="text">Text Answer</option>
                  <option value="qr_code">QR Code</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Answer Value:
                </label>
                <input
                  type="text"
                  value={step.answer_value || ''}
                  onChange={(e) => onUpdate({ answer_value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 font-medium bg-white placeholder:text-gray-500"
                  placeholder={step.answer_type === 'qr_code' ? 'QR code value' : 'Expected answer'}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
