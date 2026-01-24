// Jigsaw puzzle piece generator with interlocking tabs and notches
// Based on best practices for canvas-based jigsaw puzzle generation

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
  // Create alternating pattern for interlocking pieces
  const isTopEdge = row === 0;
  const isBottomEdge = row === rows - 1;
  const isLeftEdge = col === 0;
  const isRightEdge = col === cols - 1;
  
  // Edges are flat, interior pieces alternate tabs/notches
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
  if (length === 0) return;
  
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
      
      path.quadraticCurveTo(tabPeakX, tabPeakY, tabEndX, tabEndY);
    } else {
      // Inward notch (smooth curve)
      const notchStartX = startX + unitX * (tabCenter - tabWidth / 2);
      const notchStartY = startY + unitY * (tabCenter - tabWidth / 2);
      const notchEndX = startX + unitX * (tabCenter + tabWidth / 2);
      const notchEndY = startY + unitY * (tabCenter + tabWidth / 2);
      const notchPeakX = startX + unitX * tabCenter - perpX * tabSize;
      const notchPeakY = startY + unitY * tabCenter - perpY * tabSize;
      
      path.quadraticCurveTo(notchPeakX, notchPeakY, notchEndX, notchEndY);
    }
    
    // Second segment
    path.lineTo(endX, endY);
  }
}

/**
 * Generate interlocking jigsaw puzzle pieces from an image
 * This function properly extracts image portions and applies clipping masks
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
  
  // Draw the full image to the canvas
  fullCtx.drawImage(image, 0, 0);
  
  // Generate each piece
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const id = row * columns + col;
      const offsetX = col * pieceWidth;
      const offsetY = row * pieceHeight;
      
      // Get tab pattern for this piece
      const tabPattern = generateTabPattern(row, col, rows, columns);
      
      // Calculate padding needed for tabs (they extend beyond piece boundaries)
      const padding = Math.max(pieceWidth, pieceHeight) * TAB_SIZE * 1.5;
      
      // Create piece canvas (larger to accommodate tabs)
      const pieceCanvas = document.createElement('canvas');
      pieceCanvas.width = pieceWidth + padding * 2;
      pieceCanvas.height = pieceHeight + padding * 2;
      const pieceCtx = pieceCanvas.getContext('2d');
      if (!pieceCtx) continue;
      
      // Define the clipping path for the piece shape (centered in canvas with padding)
      const clipX = padding;
      const clipY = padding;
      const clipW = pieceWidth;
      const clipH = pieceHeight;
      
      const clipPath = new Path2D();
      
      // Build the piece path with tabs/notches
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
      
      // Calculate the source region from the original image
      // We need the piece area plus padding on all sides for tabs
      const sourceX = Math.max(0, offsetX - padding);
      const sourceY = Math.max(0, offsetY - padding);
      const sourceWidth = Math.min(image.width - sourceX, pieceWidth + padding * 2);
      const sourceHeight = Math.min(image.height - sourceY, pieceHeight + padding * 2);
      
      // Calculate where to draw this image portion in the piece canvas
      // The piece's center (at padding, padding) should align with the image's piece center (at offsetX, offsetY)
      const destX = padding - (offsetX - sourceX);
      const destY = padding - (offsetY - sourceY);
      
      // Step 1: Draw the image portion to the piece canvas
      // Draw the exact image region that corresponds to this piece (with padding for tabs)
      pieceCtx.drawImage(
        fullCanvas,
        sourceX,           // Source X in original image
        sourceY,           // Source Y in original image
        sourceWidth,       // Source width
        sourceHeight,      // Source height
        destX,             // Destination X in piece canvas
        destY,           // Destination Y in piece canvas
        sourceWidth,       // Destination width (same as source)
        sourceHeight       // Destination height (same as source)
      );
      
      // Step 2: Apply clipping mask using the piece path
      // This will show only the piece shape (with tabs), hiding the rest
      pieceCtx.save();
      pieceCtx.globalCompositeOperation = 'destination-in';
      pieceCtx.fillStyle = 'black';
      pieceCtx.fill(clipPath);
      pieceCtx.restore();
      
      // Step 3: Reset composite operation and draw outline
      pieceCtx.globalCompositeOperation = 'source-over';
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
        imageData: pieceCanvas.toDataURL('image/png'),
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
