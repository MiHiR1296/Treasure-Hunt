// TypeScript interfaces for jigsaw puzzle system

export type TabType = 'tab' | 'notch' | 'flat';

export interface Tab {
  side: 'top' | 'right' | 'bottom' | 'left';
  type: TabType;
  position: number; // 0-1, position along the edge
  width: number; // Width of tab/notch
}

export interface PieceShape {
  id: number;
  row: number;
  col: number;
  correctPosition: { row: number; col: number };
  tabs: Tab[];
  imageData: string; // Base64 image data for this piece
  mask: Path2D; // Canvas path for clipping
  width: number;
  height: number;
  offsetX: number; // Offset in original image
  offsetY: number; // Offset in original image
}

export interface PiecePosition {
  id: number;
  x: number;
  y: number;
  zIndex: number;
  isPlaced: boolean;
}
