'use client';

import { JigsawPuzzle as ReactJigsawPuzzle } from 'react-jigsaw-puzzle/lib';
import 'react-jigsaw-puzzle/lib/jigsaw-puzzle.css';

interface JigsawPuzzleProps {
  imageUrl: string;
  rows?: number;
  columns?: number;
  onSolved?: () => void;
}

export default function JigsawPuzzle({
  imageUrl,
  rows = 3,
  columns = 3,
  onSolved,
}: JigsawPuzzleProps) {
  return (
    <div className="w-full">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <ReactJigsawPuzzle
          imageSrc={imageUrl}
          rows={rows}
          columns={columns}
          onSolved={onSolved || (() => {})}
        />
      </div>
      <p className="text-sm text-gray-600 mt-4 text-center px-4">
        Drag pieces to solve the puzzle. They will snap together when placed correctly.
      </p>
    </div>
  );
}
