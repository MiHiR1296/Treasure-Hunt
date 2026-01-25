// Points calculation utilities
// INDEPENDENT POINTS SYSTEM - No coupling with hints or completion

export interface PointsCalculation {
  basePoints: number;
  hintsUsed: number;
  hintCost: number;
  pointsDeducted: number;
  pointsEarned: number;
}

/**
 * Calculate points earned for a checkpoint
 * INDEPENDENT: Only calculates based on base points and hint deductions
 * Does NOT check completion status or unlock status
 */
export function calculatePoints(
  basePoints: number,
  hintsUsed: number,
  hintCost: number = 5 // Default to 5 if not provided
): PointsCalculation {
  const pointsDeducted = hintsUsed * hintCost;
  const pointsEarned = Math.max(0, basePoints - pointsDeducted);
  
  return {
    basePoints,
    hintsUsed,
    hintCost,
    pointsDeducted,
    pointsEarned,
  };
}

/**
 * Get remaining points after using a hint
 * INDEPENDENT: Only calculates point deduction
 */
export function getRemainingPointsAfterHint(
  currentPoints: number,
  hintCost: number = 5 // Default to 5 if not provided
): number {
  return Math.max(0, currentPoints - hintCost);
}

/**
 * Check if hint can be used (max 3 hints)
 * INDEPENDENT: Only checks hint count limit
 */
export function canUseHint(hintsUsed: number): boolean {
  return hintsUsed < 3;
}
