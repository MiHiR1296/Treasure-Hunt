'use client';

import { useState, useEffect } from 'react';

interface SudokuPuzzleProps {
  grid?: number[][];
  solution?: number[][];
  onSolved?: () => void;
  initialState?: { grid?: (number | null)[][]; completed?: boolean };
  onStateChange?: (state: { grid: (number | null)[][]; completed: boolean }) => void;
}

export default function SudokuPuzzle({ 
  grid, 
  solution, 
  onSolved,
  initialState,
  onStateChange,
}: SudokuPuzzleProps) {
  const [userGrid, setUserGrid] = useState<(number | null)[][]>([]);
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    // Initialize grid - prioritize saved state, then initial grid, then empty
    if (initialState?.grid) {
      setUserGrid(initialState.grid);
      setIsComplete(initialState.completed || false);
    } else if (grid) {
      setUserGrid(grid.map(row => row.map(cell => cell === 0 ? null : cell)));
    } else {
      // Create empty 9x9 grid
      setUserGrid(Array(9).fill(null).map(() => Array(9).fill(null)));
    }
  }, [grid, initialState]);

  const validateCell = (row: number, col: number, value: number | null): boolean => {
    if (value === null) return true;
    if (value < 1 || value > 9) return false;

    // Check row
    for (let c = 0; c < 9; c++) {
      if (c !== col && userGrid[row][c] === value) return false;
    }

    // Check column
    for (let r = 0; r < 9; r++) {
      if (r !== row && userGrid[r][col] === value) return false;
    }

    // Check 3x3 box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        if (r !== row && c !== col && userGrid[r][c] === value) return false;
      }
    }

    return true;
  };

  const handleCellChange = (row: number, col: number, value: string) => {
    const numValue = value === '' ? null : parseInt(value);
    if (numValue !== null && (numValue < 1 || numValue > 9)) return;

    const newGrid = userGrid.map(r => [...r]);
    newGrid[row][col] = numValue;
    setUserGrid(newGrid);

    // Validate
    const newErrors = new Set(errors);
    const cellKey = `${row}-${col}`;
    
    if (numValue === null || validateCell(row, col, numValue)) {
      newErrors.delete(cellKey);
    } else {
      newErrors.add(cellKey);
    }
    setErrors(newErrors);

    // Check if complete and correct
    checkCompletion(newGrid);

    // Emit state change
    if (onStateChange) {
      onStateChange({ grid: newGrid, completed: isComplete });
    }
  };

  const checkCompletion = (gridToCheck: (number | null)[][]) => {
    // Check if all cells filled
    const allFilled = gridToCheck.every(row => row.every(cell => cell !== null));
    if (!allFilled) {
      setIsComplete(false);
      return;
    }

    // Check if matches solution
    if (solution) {
      const matches = gridToCheck.every((row, r) =>
        row.every((cell, c) => cell === solution[r][c])
      );
      if (matches) {
        setIsComplete(true);
        if (onStateChange) {
          onStateChange({ grid: gridToCheck, completed: true });
        }
        if (onSolved) {
          onSolved();
        }
      }
    }
  };

  const handleValidate = () => {
    const newErrors = new Set<string>();
    userGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell !== null && !validateCell(r, c, cell)) {
          newErrors.add(`${r}-${c}`);
        }
      });
    });
    setErrors(newErrors);
  };

  return (
    <div className="w-full space-y-4">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <div className="grid grid-cols-9 gap-1 max-w-md mx-auto">
          {userGrid.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const cellKey = `${rowIndex}-${colIndex}`;
              const isError = errors.has(cellKey);
              const isInitial = grid && grid[rowIndex][colIndex] !== 0;
              
              return (
                <input
                  key={cellKey}
                  type="number"
                  min="1"
                  max="9"
                  value={cell || ''}
                  onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                  disabled={isInitial}
                  className={`
                    w-10 h-10 text-center border-2 rounded
                    ${isError ? 'border-red-500 bg-red-50' : 'border-gray-300'}
                    ${isInitial ? 'bg-gray-100 font-bold' : 'bg-white'}
                    focus:outline-none focus:border-indigo-500
                  `}
                />
              );
            })
          )}
        </div>
      </div>
      
      <div className="flex gap-3">
        <button
          onClick={handleValidate}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Check Answers
        </button>
        {isComplete && (
          <div className="px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800 font-semibold">✓ Sudoku solved!</p>
          </div>
        )}
      </div>
    </div>
  );
}
