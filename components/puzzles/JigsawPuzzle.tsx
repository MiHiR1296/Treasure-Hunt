'use client';

import { useState, useEffect, useRef } from 'react';
import interact from 'interactjs';
import { generateInterlockingPieces } from '@/lib/puzzles/jigsawGenerator';
import { PieceShape } from '@/lib/puzzles/jigsawTypes';

interface JigsawPuzzleProps {
  imageUrl: string;
  rows?: number;
  columns?: number;
  onSolved?: () => void;
}

interface PiecePosition {
  id: number;
  x: number;
  y: number;
  zIndex: number;
  isPlaced: boolean;
}

const SNAP_DISTANCE = 30; // pixels
const PUZZLE_SCALE = 0.9; // Scale down puzzle for mobile
const MOBILE_SCALE = 0.85; // Additional scale for mobile devices

export default function JigsawPuzzle({
  imageUrl,
  rows = 3,
  columns = 3,
  onSolved,
}: JigsawPuzzleProps) {
  const [pieces, setPieces] = useState<PieceShape[]>([]);
  const [positions, setPositions] = useState<Map<number, PiecePosition>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSolved, setIsSolved] = useState(false);
  const [draggedPieceId, setDraggedPieceId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pieceRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    loadPuzzle();
    return () => {
      // Cleanup interact instances
      interact('.jigsaw-piece').unset();
    };
  }, [imageUrl, rows, columns]);

  useEffect(() => {
    if (pieces.length > 0 && positions.size > 0) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        setupInteract();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pieces, positions]);

  const loadPuzzle = async () => {
    try {
      setIsLoading(true);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        // Generate interlocking pieces
        const generatedPieces = generateInterlockingPieces(img, rows, columns);

        // Calculate puzzle dimensions with better mobile support
        const containerWidth = containerRef.current?.clientWidth || 600;
        const isMobile = containerWidth < 768;
        const baseScale = isMobile ? MOBILE_SCALE : PUZZLE_SCALE;
        const scale = Math.min(
          (containerWidth * baseScale) / img.width,
          (containerWidth * baseScale) / img.height
        );
        const puzzleWidth = img.width * scale;
        const puzzleHeight = img.height * scale;
        const pieceWidth = puzzleWidth / columns;
        const pieceHeight = puzzleHeight / rows;

        // Initialize positions (scattered randomly)
        const initialPositions = new Map<number, PiecePosition>();
        generatedPieces.forEach((piece, index) => {
          // Scatter pieces randomly around the container
          const scatterX = Math.random() * (containerWidth - pieceWidth);
          const scatterY = Math.random() * 200 + 400; // Below puzzle area
          
          initialPositions.set(piece.id, {
            id: piece.id,
            x: scatterX,
            y: scatterY,
            zIndex: index,
            isPlaced: false,
          });
        });

        setPieces(generatedPieces);
        setPositions(initialPositions);
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

  const setupInteract = () => {
    // Clean up existing interact instances
    interact('.jigsaw-piece').unset();
    
    pieces.forEach((piece) => {
      const element = pieceRefs.current.get(piece.id);
      if (!element || !containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const isMobile = containerWidth < 768;
      const baseScale = isMobile ? MOBILE_SCALE : PUZZLE_SCALE;
      const scale = Math.min(
        (containerWidth * baseScale) / (piece.width * columns),
        (containerWidth * baseScale) / (piece.height * rows)
      );
      const correctX = (piece.col * piece.width * scale) + (containerWidth - piece.width * columns * scale) / 2;
      const correctY = (piece.row * piece.height * scale) + 20;

      interact(element)
        .draggable({
          // Better mobile touch support
          allowFrom: null,
          ignoreFrom: null,
          listeners: {
            start: () => {
              setDraggedPieceId(piece.id);
              // Bring to front
              setPositions((prev) => {
                const newPositions = new Map(prev);
                const pos = newPositions.get(piece.id);
                if (pos) {
                  const maxZ = Math.max(...Array.from(newPositions.values()).map(p => p.zIndex));
                  pos.zIndex = maxZ + 1;
                }
                return newPositions;
              });
            },
            move: (event) => {
              setPositions((prev) => {
                const newPositions = new Map(prev);
                const pos = newPositions.get(piece.id);
                if (pos) {
                  pos.x += event.dx;
                  pos.y += event.dy;
                }
                return newPositions;
              });
            },
            end: () => {
              setDraggedPieceId(null);
              checkSnap(piece.id, correctX, correctY);
            },
          },
          modifiers: [
            interact.modifiers.restrict({
              restriction: containerRef.current || 'parent',
              endOnly: true,
            }),
          ],
        });
    });
  };

  const checkSnap = (pieceId: number, correctX: number, correctY: number) => {
    setPositions((prev) => {
      const pos = prev.get(pieceId);
      if (!pos) return prev;

      const distance = Math.sqrt(
        Math.pow(pos.x - correctX, 2) + Math.pow(pos.y - correctY, 2)
      );

      if (distance < SNAP_DISTANCE) {
        // Snap to correct position
        const newPositions = new Map(prev);
        const updatedPos = newPositions.get(pieceId);
        if (updatedPos) {
          updatedPos.x = correctX;
          updatedPos.y = correctY;
          updatedPos.isPlaced = true;
          
          // Check if solved after state update
          setTimeout(() => {
            checkSolved(newPositions);
          }, 0);
          
          return newPositions;
        }
      }
      return prev;
    });
  };

  const checkSolved = (currentPositions?: Map<number, PiecePosition>) => {
    const positionsToCheck = currentPositions || positions;
    const allPlaced = pieces.every((piece) => {
      const pos = positionsToCheck.get(piece.id);
      return pos?.isPlaced === true;
    });

    if (allPlaced && !isSolved) {
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

  const containerWidth = containerRef.current?.clientWidth || 600;
  const isMobile = containerWidth < 768;
  const baseScale = isMobile ? MOBILE_SCALE : PUZZLE_SCALE;
  const scale = Math.min(
    (containerWidth * baseScale) / (pieces[0]?.width * columns || 600),
    (containerWidth * baseScale) / (pieces[0]?.height * rows || 600)
  );
  const puzzleWidth = (pieces[0]?.width || 200) * columns * scale;
  const puzzleHeight = (pieces[0]?.height || 200) * rows * scale;

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="bg-white rounded-lg p-4 border-2 border-gray-200 relative"
        style={{
          touchAction: 'none',
          userSelect: 'none',
          minHeight: '400px',
        }}
      >
        {/* Puzzle area (where pieces should go) */}
        <div
          className="absolute border-2 border-dashed border-gray-300 rounded-lg bg-gray-50"
          style={{
            left: '50%',
            top: '20px',
            transform: 'translateX(-50%)',
            width: `${puzzleWidth}px`,
            height: `${puzzleHeight}px`,
            pointerEvents: 'none',
          }}
        />

        {/* Render pieces */}
        {pieces.map((piece) => {
          const pos = positions.get(piece.id);
          if (!pos) return null;

          const isDragging = draggedPieceId === piece.id;
          const containerWidth = containerRef.current?.clientWidth || 600;
          const isMobile = containerWidth < 768;
          const baseScale = isMobile ? MOBILE_SCALE : PUZZLE_SCALE;
          const pieceScale = Math.min(
            (containerWidth * baseScale) / (piece.width * columns),
            (containerWidth * baseScale) / (piece.height * rows)
          );
          const correctX = (piece.col * piece.width * pieceScale) + (containerWidth - piece.width * columns * pieceScale) / 2;
          const correctY = (piece.row * piece.height * pieceScale) + 20; // Offset for puzzle area

          return (
            <div
              key={piece.id}
              ref={(el) => {
                if (el) pieceRefs.current.set(piece.id, el);
              }}
              className="jigsaw-piece absolute cursor-move"
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${piece.width * pieceScale}px`,
                height: `${piece.height * pieceScale}px`,
                zIndex: pos.zIndex,
                opacity: isDragging ? 0.9 : 1,
                transform: isDragging ? 'scale(1.05) rotate(2deg)' : 'scale(1) rotate(0deg)',
                transition: pos.isPlaced ? 'all 0.3s ease' : 'transform 0.1s ease',
                boxShadow: pos.isPlaced
                  ? '0 4px 6px rgba(34, 197, 94, 0.3)'
                  : isDragging
                  ? '0 8px 16px rgba(0, 0, 0, 0.3)'
                  : '0 2px 4px rgba(0, 0, 0, 0.1)',
                willChange: isDragging ? 'transform' : 'auto',
                touchAction: 'none', // Prevent default touch behaviors
              }}
            >
              <img
                src={piece.imageData}
                alt={`Piece ${piece.id}`}
                className="w-full h-full"
                draggable={false}
                style={{
                  pointerEvents: 'none',
                }}
              />
              {pos.isPlaced && (
                <div className="absolute inset-0 border-2 border-green-500 rounded pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-gray-600 mt-4 text-center px-4">
        {isSolved 
          ? 'Great job! Puzzle completed!'
          : 'Drag pieces to solve the puzzle. They will snap into place when close to the correct position.'}
      </p>

      {isSolved && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-semibold text-center">✓ Puzzle solved!</p>
        </div>
      )}
    </div>
  );
}
