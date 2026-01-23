// Points calculation utilities

export interface PointsCalculation {
  basePoints: number;
  hintsUsed: number;
  pointsDeducted: number;
  pointsEarned: number;
}

/**
 * Calculate points earned for a checkpoint
 */
export function calculatePoints(
  basePoints: number,
  hintsUsed: number
): PointsCalculation {
  const pointsDeducted = hintsUsed * 5;
  const pointsEarned = Math.max(0, basePoints - pointsDeducted);
  
  return {
    basePoints,
    hintsUsed,
    pointsDeducted,
    pointsEarned,
  };
}

/**
 * Get remaining points after using a hint
 */
export function getRemainingPointsAfterHint(
  currentPoints: number
): number {
  return Math.max(0, currentPoints - 5);
}

/**
 * Check if hint can be used (max 3 hints)
 */
export function canUseHint(hintsUsed: number): boolean {
  return hintsUsed < 3;
}
