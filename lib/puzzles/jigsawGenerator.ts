// Jigsaw puzzle piece generator with interlocking tabs and notches

import { PieceShape, Tab, TabType } from './jigsawTypes';

const TAB_SIZE = 0.15; // Size of tabs/notches relative to piece size
const TAB_WIDTH = 0.3; // Width of tab along edge

/**
 * Generate tab pattern for a piece based on its position
 */
function generateTabPattern(row: number, col: number, rows: number, cols: number): {
  top: TabType;
  right: TabType;
  bottom: TabType;
  left: TabType;
} {
  // Create alternating pattern
  // Corners have tabs/notches on both sides
  // Edges alternate
  // Center pieces can have any pattern
  
  const isTopEdge = row === 0;
  const isBottomEdge = row === rows - 1;
  const isLeftEdge = col === 0;
  const isRightEdge = col === cols - 1;
  
  // Top edge: flat
  // Bottom edge: tabs/notches
  // Left edge: flat
  // Right edge: tabs/notches
  // Interior: alternating pattern
  
  const top: TabType = isTopEdge ? 'flat' : (row % 2 === 0 ? 'notch' : 'tab');
  const bottom: TabType = isBottomEdge ? 'flat' : (row % 2 === 0 ? 'tab' : 'notch');
  const left: TabType = isLeftEdge ? 'flat' : (col % 2 === 0 ? 'notch' : 'tab');
  const right: TabType = isRightEdge ? 'flat' : (col % 2 === 0 ? 'tab' : 'notch');
  
  return { top, right, bottom, left };
}

/**
 * Create a path for a piece edge with tabs/notches
 */
function createEdgePath(
  path: Path2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tabType: TabType
): void {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const unitX = dx / length;
  const unitY = dy / length;
  
  // Perpendicular vector for tab direction
  const perpX = -unitY;
  const perpY = unitX;
  
  const tabSize = length * TAB_SIZE;
  const tabWidth = length * TAB_WIDTH;
  const tabCenter = length / 2;
  
  path.moveTo(startX, startY);
  
  if (tabType === 'flat') {
    path.lineTo(endX, endY);
  } else {
    // First segment
    const firstEnd = tabCenter - tabWidth / 2;
    path.lineTo(
      startX + unitX * firstEnd,
      startY + unitY * firstEnd
    );
    
    // Tab or notch
    if (tabType === 'tab') {
      // Outward tab (smooth curve)
      const tabStartX = startX + unitX * (tabCenter - tabWidth / 2);
      const tabStartY = startY + unitY * (tabCenter - tabWidth / 2);
      const tabEndX = startX + unitX * (tabCenter + tabWidth / 2);
      const tabEndY = startY + unitY * (tabCenter + tabWidth / 2);
      const tabPeakX = startX + unitX * tabCenter + perpX * tabSize;
      const tabPeakY = startY + unitY * tabCenter + perpY * tabSize;
      
      // Use quadratic curve for smooth tab
      path.quadraticCurveTo(tabPeakX, tabPeakY, tabEndX, tabEndY);
    } else {
      // Inward notch (smooth curve)
      const notchStartX = startX + unitX * (tabCenter - tabWidth / 2);
      const notchStartY = startY + unitY * (tabCenter - tabWidth / 2);
      const notchEndX = startX + unitX * (tabCenter + tabWidth / 2);
      const notchEndY = startY + unitY * (tabCenter + tabWidth / 2);
      const notchPeakX = startX + unitX * tabCenter - perpX * tabSize;
      const notchPeakY = startY + unitY * tabCenter - perpY * tabSize;
      
      // Use quadratic curve for smooth notch
      path.quadraticCurveTo(notchPeakX, notchPeakY, notchEndX, notchEndY);
    }
    
    // Second segment
    path.lineTo(endX, endY);
  }
}

/**
 * Generate interlocking jigsaw puzzle pieces from an image
 */
export function generateInterlockingPieces(
  image: HTMLImageElement,
  rows: number,
  columns: number
): PieceShape[] {
  const pieces: PieceShape[] = [];
  const pieceWidth = image.width / columns;
  const pieceHeight = image.height / rows;
  
  // Create a canvas for the full image
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = image.width;
  fullCanvas.height = image.height;
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) return pieces;
  
  fullCtx.drawImage(image, 0, 0);
  
  // Generate each piece
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const id = row * columns + col;
      const offsetX = col * pieceWidth;
      const offsetY = row * pieceHeight;
      
      // Get tab pattern for this piece
      const tabPattern = generateTabPattern(row, col, rows, columns);
      
      // Create piece canvas (slightly larger to accommodate tabs)
      const padding = Math.max(pieceWidth, pieceHeight) * TAB_SIZE * 1.5;
      const pieceCanvas = document.createElement('canvas');
      pieceCanvas.width = pieceWidth + padding * 2;
      pieceCanvas.height = pieceHeight + padding * 2;
      const pieceCtx = pieceCanvas.getContext('2d');
      if (!pieceCtx) continue;
      
      // Create clipping path with tabs/notches
      const clipX = padding;
      const clipY = padding;
      const clipW = pieceWidth;
      const clipH = pieceHeight;
      
      const clipPath = new Path2D();
      
      // Create clipping path with tabs/notches
      // Top edge
      createEdgePath(
        clipPath,
        clipX,
        clipY,
        clipX + clipW,
        clipY,
        tabPattern.top
      );
      
      // Right edge
      createEdgePath(
        clipPath,
        clipX + clipW,
        clipY,
        clipX + clipW,
        clipY + clipH,
        tabPattern.right
      );
      
      // Bottom edge
      createEdgePath(
        clipPath,
        clipX + clipW,
        clipY + clipH,
        clipX,
        clipY + clipH,
        tabPattern.bottom
      );
      
      // Left edge
      createEdgePath(
        clipPath,
        clipX,
        clipY + clipH,
        clipX,
        clipY,
        tabPattern.left
      );
      
      clipPath.closePath();
      
      // Apply clipping and draw piece
      pieceCtx.save();
      pieceCtx.clip(clipPath);
      
      // Draw the piece image with offset to account for padding
      pieceCtx.drawImage(
        fullCanvas,
        offsetX - padding,
        offsetY - padding,
        pieceWidth + padding * 2,
        pieceHeight + padding * 2,
        0,
        0,
        pieceWidth + padding * 2,
        pieceHeight + padding * 2
      );
      
      pieceCtx.restore();
      
      // Draw outline for better visibility
      pieceCtx.strokeStyle = '#e5e7eb';
      pieceCtx.lineWidth = 1;
      pieceCtx.stroke(clipPath);
      
      // Store piece data
      const tabs: Tab[] = [
        { side: 'top', type: tabPattern.top, position: 0.5, width: TAB_WIDTH },
        { side: 'right', type: tabPattern.right, position: 0.5, width: TAB_WIDTH },
        { side: 'bottom', type: tabPattern.bottom, position: 0.5, width: TAB_WIDTH },
        { side: 'left', type: tabPattern.left, position: 0.5, width: TAB_WIDTH },
      ];
      
      pieces.push({
        id,
        row,
        col,
        correctPosition: { row, col },
        tabs,
        imageData: pieceCanvas.toDataURL(),
        mask: new Path2D(), // Path2D can't be serialized, create empty for type compatibility
        width: pieceWidth,
        height: pieceHeight,
        offsetX,
        offsetY,
      });
    }
  }
  
  return pieces;
}
