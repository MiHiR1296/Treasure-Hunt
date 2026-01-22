'use client';

import { useState, useEffect, useRef } from 'react';

interface JigsawPuzzleProps {
  imageUrl: string;
  rows?: number;
  columns?: number;
  onSolved?: () => void;
}

interface PuzzlePiece {
  id: number;
  correctPosition: number;
  currentPosition: number;
  image: string;
}

export default function JigsawPuzzle({ 
  imageUrl, 
  rows = 3, 
  columns = 3,
  onSolved 
}: JigsawPuzzleProps) {
  const [pieces, setPieces] = useState<PuzzlePiece[]>([]);
  const [isSolved, setIsSolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [draggedPiece, setDraggedPiece] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadPuzzle();
  }, [imageUrl, rows, columns]);

  const loadPuzzle = async () => {
    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const pieceWidth = img.width / columns;
        const pieceHeight = img.height / rows;
        const newPieces: PuzzlePiece[] = [];

        // Create pieces
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < columns; col++) {
            const id = row * columns + col;
            const pieceCanvas = document.createElement('canvas');
            const pieceCtx = pieceCanvas.getContext('2d');
            if (!pieceCtx) continue;

            pieceCanvas.width = pieceWidth;
            pieceCanvas.height = pieceHeight;
            pieceCtx.drawImage(
              canvas,
              col * pieceWidth,
              row * pieceHeight,
              pieceWidth,
              pieceHeight,
              0,
              0,
              pieceWidth,
              pieceHeight
            );

            newPieces.push({
              id,
              correctPosition: id,
              currentPosition: id,
              image: pieceCanvas.toDataURL(),
            });
          }
        }

        // Shuffle pieces
        const shuffled = [...newPieces].sort(() => Math.random() - 0.5);
        shuffled.forEach((piece, index) => {
          piece.currentPosition = index;
        });

        setPieces(shuffled);
        setIsLoading(false);
      };
      img.onerror = () => {
        setIsLoading(false);
        console.error('Failed to load puzzle image');
      };
      img.src = imageUrl;
    } catch (error) {
      console.error('Error loading puzzle:', error);
      setIsLoading(false);
    }
  };

  const handleDragStart = (pieceId: number) => {
    setDraggedPiece(pieceId);
  };

  const handleDragOver = (e: React.DragEvent, targetPosition: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetPosition: number) => {
    e.preventDefault();
    if (draggedPiece === null) return;

    const newPieces = [...pieces];
    const draggedIndex = newPieces.findIndex(p => p.id === draggedPiece);
    const targetIndex = newPieces.findIndex(p => p.currentPosition === targetPosition);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Swap positions
      const temp = newPieces[draggedIndex].currentPosition;
      newPieces[draggedIndex].currentPosition = newPieces[targetIndex].currentPosition;
      newPieces[targetIndex].currentPosition = temp;

      setPieces(newPieces);
      checkSolved(newPieces);
    }

    setDraggedPiece(null);
  };

  const checkSolved = (currentPieces: PuzzlePiece[]) => {
    const solved = currentPieces.every(piece => 
      piece.currentPosition === piece.correctPosition
    );

    if (solved && !isSolved) {
      setIsSolved(true);
      if (onSolved) {
        onSolved();
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-600">Loading puzzle...</p>
      </div>
    );
  }

  if (pieces.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-red-600">Failed to load puzzle image</p>
      </div>
    );
  }

  const pieceWidth = 100 / columns;
  const pieceHeight = 100 / rows;

  return (
    <div className="w-full">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <div className="relative" style={{ aspectRatio: `${columns}/${rows}` }}>
          {pieces.map((piece) => {
            const position = piece.currentPosition;
            const row = Math.floor(position / columns);
            const col = position % columns;

            return (
              <div
                key={piece.id}
                draggable
                onDragStart={() => handleDragStart(piece.id)}
                onDragOver={(e) => handleDragOver(e, piece.currentPosition)}
                onDrop={(e) => handleDrop(e, piece.currentPosition)}
                className="absolute border border-gray-300 cursor-move hover:border-indigo-500 transition-colors"
                style={{
                  left: `${col * pieceWidth}%`,
                  top: `${row * pieceHeight}%`,
                  width: `${pieceWidth}%`,
                  height: `${pieceHeight}%`,
                  opacity: draggedPiece === piece.id ? 0.5 : 1,
                }}
              >
                <img
                  src={piece.image}
                  alt={`Piece ${piece.id}`}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              </div>
            );
          })}
        </div>
        <p className="text-sm text-gray-600 mt-4 text-center">
          Drag and drop pieces to solve the puzzle
        </p>
      </div>
      {isSolved && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-semibold">✓ Puzzle solved!</p>
        </div>
      )}
    </div>
  );
}
