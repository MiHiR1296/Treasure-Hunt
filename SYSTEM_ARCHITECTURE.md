# System Architecture - Independent Systems

## Overview
The checkpoint system has been refactored into **three completely independent systems** to eliminate confusion and bottlenecks:

1. **Hint System** - Independent tracking of hints used
2. **Points System** - Independent calculation based on hints
3. **Completion System** - Independent verification of checkpoint unlock

## 1. Hint System

### Purpose
Tracks which hints have been used (text hints and puzzle hints).

### Database Fields
- `hints_used` (integer) - Total number of hints used (0-3)

### Rules
- Maximum 3 hints per checkpoint (any combination of text + puzzle)
- Each hint costs points (configurable per checkpoint via `hint_cost`)
- Hints can be used before or after unlock
- Hint usage does NOT affect completion status

### Components
- `ClueDisplay` - Main hint interface
- `HintsModal` - Alternative hint interface
- `HintConfirmationDialog` - Confirmation before using hint

## 2. Points System

### Purpose
Calculates points earned based on base points and hint deductions.

### Database Fields
- `points_earned` (integer) - Final points after hint deductions

### Calculation Formula
```
points_earned = basePoints - (hints_used * hint_cost)
```

### Rules
- **Independent** - Does NOT check completion or unlock status
- Points are calculated whenever hints are used
- Points are saved to database immediately when hints are used
- Points can be calculated even if checkpoint is not unlocked yet

### Configuration
- `hint_cost` (integer) - Points deducted per hint (default: 5)
- Set per checkpoint in admin panel
- Can be different for each checkpoint

### Components
- `lib/utils/points.ts` - Point calculation utilities
- All components use `hintCost` parameter from checkpoint

## 3. Completion System

### Purpose
Verifies that checkpoint can be marked as complete.

### Database Fields
- `unlocked_at` (timestamp) - When correct QR/code/GPS was verified
- `completed_at` (timestamp) - When checkpoint was marked complete

### Rules
- **Independent** - Does NOT depend on hints or points
- Completion requires: `unlocked_at !== null`
- Completion does NOT require any hints to be used
- Completion does NOT require any specific points
- Once `completed_at` is set, checkpoint is complete

### Verification Flow
1. User scans QR / enters code / reaches GPS
2. System sets `unlocked_at` timestamp
3. User can now mark checkpoint as complete
4. System sets `completed_at` timestamp

### Components
- `ClueDisplay.verifyCanComplete()` - Checks `unlocked_at !== null`
- `ClueDisplay.handleComplete()` - Sets `completed_at` timestamp

## System Independence

### Key Principles

1. **No Cross-Dependencies**
   - Hint system does NOT check completion status
   - Points system does NOT check completion status
   - Completion system does NOT check hints or points

2. **Separate Database Fields**
   - `hints_used` - Hint system only
   - `points_earned` - Points system only
   - `unlocked_at` - Completion system only
   - `completed_at` - Completion system only

3. **Separate State Management**
   - Each system has its own state variables
   - No shared flags or verification checks
   - Clear separation in code with comments

## Admin Configuration

### Setting Hint Cost
1. Go to Admin Panel
2. Create or Edit Checkpoint
3. Set "Hint Cost" field (default: 5)
4. Each hint will deduct this many points

### Example
- Checkpoint A: `hint_cost = 3` (each hint costs 3 points)
- Checkpoint B: `hint_cost = 10` (each hint costs 10 points)
- Checkpoint C: `hint_cost = 0` (hints are free)

## Migration

Run the migration to add `hint_cost` field:
```sql
-- File: supabase/migrations/add_hint_cost_to_checkpoints.sql
ALTER TABLE checkpoints
ADD COLUMN IF NOT EXISTS hint_cost integer DEFAULT 5;
```

## Benefits

1. **Clarity** - Each system has a single, clear purpose
2. **No Bottlenecks** - Systems don't block each other
3. **Flexibility** - Admin can set different hint costs per checkpoint
4. **Maintainability** - Easy to understand and modify each system independently
5. **No Confusion** - Clear separation prevents bugs from mixed logic

## Code Structure

### ClueDisplay Component
```typescript
// 1. HINT SYSTEM - Independent tracking
const [hintsUsed, setHintsUsed] = useState(0);
// ... hint state

// 2. POINTS SYSTEM - Independent calculation
const [currentPoints, setCurrentPoints] = useState(checkpointPoints);
// ... points calculation using hintCost

// 3. COMPLETION SYSTEM - Independent verification
const [canComplete, setCanComplete] = useState(false);
// ... only checks unlocked_at !== null
```

### Points Utilities
```typescript
// Independent calculation - no completion checks
calculatePoints(basePoints, hintsUsed, hintCost)
getRemainingPointsAfterHint(currentPoints, hintCost)
```

## Summary

- ✅ **Hint System**: Tracks hints used (0-3), independent of completion
- ✅ **Points System**: Calculates points based on hints, independent of completion
- ✅ **Completion System**: Verifies unlock status only, independent of hints/points
- ✅ **Admin Control**: Can set `hint_cost` per checkpoint
- ✅ **Clear Separation**: No cross-dependencies or shared flags
