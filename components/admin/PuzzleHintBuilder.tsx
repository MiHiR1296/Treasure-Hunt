'use client';

import { useState, useEffect } from 'react';
import { PuzzleHint, PuzzleType } from '../puzzles/types';
import { supabase } from '@/lib/supabase/client';

export interface PuzzleHintConfig {
  id?: string;
  hint_slot: number; // 1, 2, or 3
  puzzle_type: PuzzleType;
  puzzle_config: Record<string, any>;
  puzzle_image_url: string | null;
  points_cost: number;
  completion_message: string;
  show_custom_message: boolean;
  title: string;
  description: string;
  imageFile?: File | null;
}

interface PuzzleHintBuilderProps {
  hints: PuzzleHintConfig[];
  onChange: (hints: PuzzleHintConfig[]) => void;
  checkpointId?: string;
}

export default function PuzzleHintBuilder({ hints, onChange, checkpointId }: PuzzleHintBuilderProps) {
  const addHint = () => {
    // Find available slot
    const usedSlots = new Set(hints.map(h => h.hint_slot));
    let availableSlot = 1;
    for (let i = 1; i <= 3; i++) {
      if (!usedSlots.has(i)) {
        availableSlot = i;
        break;
      }
    }

    const newHint: PuzzleHintConfig = {
      hint_slot: availableSlot,
      puzzle_type: 'jigsaw',
      puzzle_config: {},
      puzzle_image_url: null,
      points_cost: 5,
      completion_message: '',
      show_custom_message: false,
      title: '',
      description: '',
      imageFile: null,
    };
    onChange([...hints, newHint]);
  };

  const removeHint = (id: string | undefined) => {
    if (!id) {
      // New hint without ID - remove by index
      const index = hints.findIndex(h => !h.id);
      if (index !== -1) {
        onChange(hints.filter((_, i) => i !== index));
      }
    } else {
      onChange(hints.filter(h => h.id !== id));
    }
  };

  const updateHint = (id: string | undefined, updates: Partial<PuzzleHintConfig>) => {
    const newHints = hints.map(h => {
      if (id && h.id === id) {
        return { ...h, ...updates };
      } else if (!id && !h.id) {
        // Match new hint without ID
        return { ...h, ...updates };
      }
      return h;
    });
    onChange(newHints);
  };

  const handleImageUpload = async (hint: PuzzleHintConfig, file: File) => {
    // For new checkpoints, checkpointId might not be available yet
    // In that case, create a temporary file path and upload will happen when checkpoint is saved
    if (!checkpointId) {
      // Create a preview URL from the file for immediate display
      const reader = new FileReader();
      reader.onloadend = () => {
        updateHint(hint.id, { 
          puzzle_image_url: reader.result as string, 
          imageFile: file 
        });
      };
      reader.readAsDataURL(file);
      
      // Show info message that image will be uploaded when checkpoint is saved
      console.info('Image will be uploaded when checkpoint is created. Using preview for now.');
      return;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${checkpointId}/puzzle-hint-${hint.id || Date.now()}-${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('puzzle-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('puzzle-images')
        .getPublicUrl(fileName);

      updateHint(hint.id, { puzzle_image_url: data.publicUrl, imageFile: file });
    } catch (error: any) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Puzzle Hints ({hints.length})</h3>
        <button
          type="button"
          onClick={addHint}
          disabled={hints.length >= 3}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add Puzzle Hint
        </button>
      </div>

      {hints.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-gray-600">No puzzle hints yet. Click "Add Puzzle Hint" to create one.</p>
          <p className="text-xs text-gray-500 mt-2">Puzzle hints replace text hints in slots 1-3.</p>
        </div>
      )}

      <div className="space-y-4">
        {hints.map((hint, index) => (
          <PuzzleHintEditor
            key={hint.id || `new-${index}`}
            hint={hint}
            allHints={hints}
            onUpdate={(updates) => updateHint(hint.id, updates)}
            onRemove={() => removeHint(hint.id)}
            onImageUpload={(file) => handleImageUpload(hint, file)}
            checkpointId={checkpointId}
          />
        ))}
      </div>
    </div>
  );
}

interface PuzzleHintEditorProps {
  hint: PuzzleHintConfig;
  allHints: PuzzleHintConfig[];
  onUpdate: (updates: Partial<PuzzleHintConfig>) => void;
  onRemove: () => void;
  onImageUpload: (file: File) => void;
  checkpointId?: string;
}

function PuzzleHintEditor({
  hint,
  allHints,
  onUpdate,
  onRemove,
  onImageUpload,
  checkpointId,
}: PuzzleHintEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hintIndex = allHints.findIndex(h => (hint.id && h.id === hint.id) || (!hint.id && !h.id && h === hint));

  const puzzleTypes: PuzzleType[] = ['jigsaw', 'sudoku', 'crossword', 'word_search', 'circular_rotate'];
  const availableSlots = [1, 2, 3].filter(slot => 
    slot === hint.hint_slot || !allHints.some(h => h.hint_slot === slot)
  );

  return (
    <div className="border-2 border-gray-300 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h4 className="font-semibold text-gray-900">
            Puzzle Hint (Slot {hint.hint_slot})
          </h4>
          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
            {hint.puzzle_type}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-red-600 hover:text-red-800 font-semibold"
          >
            Remove
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Hint Slot *
              </label>
              <select
                value={hint.hint_slot}
                onChange={(e) => onUpdate({ hint_slot: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              >
                {availableSlots.map(slot => (
                  <option key={slot} value={slot}>Slot {slot}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Points Cost *
              </label>
              <input
                type="number"
                min="0"
                value={hint.points_cost}
                onChange={(e) => onUpdate({ points_cost: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Puzzle Type *
            </label>
            <select
              value={hint.puzzle_type}
              onChange={(e) => onUpdate({ puzzle_type: e.target.value as PuzzleType, puzzle_config: {} })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
            >
              {puzzleTypes.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title (optional)
            </label>
            <input
              type="text"
              value={hint.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              placeholder="Puzzle hint title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description (optional)
            </label>
            <textarea
              value={hint.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              rows={2}
              placeholder="Puzzle hint description"
            />
          </div>

          {/* Puzzle-specific configuration */}
          {hint.puzzle_type === 'jigsaw' && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h5 className="font-semibold text-gray-900">Jigsaw Configuration</h5>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rows</label>
                  <input
                    type="number"
                    min="2"
                    max="6"
                    value={hint.puzzle_config?.rows || 3}
                    onChange={(e) => onUpdate({
                      puzzle_config: { ...hint.puzzle_config, rows: parseInt(e.target.value) || 3 }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Columns</label>
                  <input
                    type="number"
                    min="2"
                    max="6"
                    value={hint.puzzle_config?.columns || 3}
                    onChange={(e) => onUpdate({
                      puzzle_config: { ...hint.puzzle_config, columns: parseInt(e.target.value) || 3 }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Puzzle Image *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImageUpload(file);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
                {hint.puzzle_image_url && (
                  <div className="mt-2">
                    <img src={hint.puzzle_image_url} alt="Puzzle" className="max-w-xs rounded-lg border border-gray-300" />
                  </div>
                )}
              </div>
            </div>
          )}

          {hint.puzzle_type === 'sudoku' && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h5 className="font-semibold text-gray-900">Sudoku Configuration</h5>
              <p className="text-sm text-gray-600">
                Sudoku grid and solution should be configured as JSON arrays.
                Use the puzzle chain builder for detailed sudoku setup.
              </p>
            </div>
          )}

          {hint.puzzle_type === 'crossword' && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h5 className="font-semibold text-gray-900">Crossword Configuration</h5>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Puzzle Image *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImageUpload(file);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
                {hint.puzzle_image_url && (
                  <div className="mt-2">
                    <img src={hint.puzzle_image_url} alt="Puzzle" className="max-w-xs rounded-lg border border-gray-300" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Answers (comma-separated)</label>
                <input
                  type="text"
                  value={hint.puzzle_config?.answers?.join(', ') || ''}
                  onChange={(e) => onUpdate({
                    puzzle_config: {
                      ...hint.puzzle_config,
                      answers: e.target.value.split(',').map(a => a.trim()).filter(Boolean)
                    }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  placeholder="answer1, answer2, answer3"
                />
              </div>
            </div>
          )}

          {hint.puzzle_type === 'word_search' && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h5 className="font-semibold text-gray-900">Word Search Configuration</h5>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Puzzle Image *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImageUpload(file);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
                {hint.puzzle_image_url && (
                  <div className="mt-2">
                    <img src={hint.puzzle_image_url} alt="Puzzle" className="max-w-xs rounded-lg border border-gray-300" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Words to Find (comma-separated)</label>
                <input
                  type="text"
                  value={hint.puzzle_config?.words?.join(', ') || ''}
                  onChange={(e) => onUpdate({
                    puzzle_config: {
                      ...hint.puzzle_config,
                      words: e.target.value.split(',').map(w => w.trim()).filter(Boolean)
                    }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  placeholder="word1, word2, word3"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Word (optional)</label>
                <input
                  type="text"
                  value={hint.puzzle_config?.targetWord || ''}
                  onChange={(e) => onUpdate({
                    puzzle_config: { ...hint.puzzle_config, targetWord: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
              </div>
            </div>
          )}

          {hint.puzzle_type === 'circular_rotate' && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h5 className="font-semibold text-gray-900">Circular Rotate Configuration</h5>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Puzzle Image *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImageUpload(file);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
                {hint.puzzle_image_url && (
                  <div className="mt-2">
                    <img src={hint.puzzle_image_url} alt="Puzzle" className="max-w-xs rounded-lg border border-gray-300" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Segments</label>
                <input
                  type="number"
                  min="4"
                  max="16"
                  value={hint.puzzle_config?.segments || 8}
                  onChange={(e) => onUpdate({
                    puzzle_config: { ...hint.puzzle_config, segments: parseInt(e.target.value) || 8 }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
              </div>
            </div>
          )}

          {/* Completion Message */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                id={`show-message-${hint.id || hintIndex}`}
                checked={hint.show_custom_message}
                onChange={(e) => onUpdate({ show_custom_message: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor={`show-message-${hint.id || hintIndex}`} className="text-sm font-medium text-gray-700">
                Show custom completion message
              </label>
            </div>
            {hint.show_custom_message && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Completion Message
                </label>
                <textarea
                  value={hint.completion_message}
                  onChange={(e) => onUpdate({ completion_message: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  rows={3}
                  placeholder="Message shown when puzzle is completed..."
                />
              </div>
            )}
            {!hint.show_custom_message && (
              <p className="text-xs text-gray-600">
                If unchecked, only an OK button will be shown when puzzle is completed.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
