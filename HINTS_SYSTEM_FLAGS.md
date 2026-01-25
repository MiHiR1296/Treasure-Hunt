# Hints System - Clear Flag Architecture

## Overview
This document explains the clear flag system used throughout the application to track checkpoint state. This ensures no bottlenecks and clear separation of concerns.

## Core Flags

### 1. `hasProgress`
- **Definition**: A progress record exists in the database for this team/checkpoint
- **Database Check**: `progress` record exists (any record)
- **Use Case**: 
  - Determines if hints can be loaded/displayed
  - Tracks if team has interacted with checkpoint at all
- **When Set**: 
  - When hints are used (even before unlock)
  - When checkpoint is unlocked
  - When checkpoint is completed

### 2. `isUnlocked`
- **Definition**: Checkpoint has been unlocked via QR code, GPS, or manual code
- **Database Check**: `progress.unlocked_at !== null`
- **Use Case**:
  - Determines if ClueDisplay component should be shown
  - Controls access to checkpoint question/clue
- **When Set**: 
  - When QR code is scanned correctly
  - When GPS location is reached
  - When manual code is entered correctly
- **NOT Set When**: 
  - Only hints are used (hints can be used before unlock)

### 3. `isCompleted`
- **Definition**: Checkpoint has been marked as complete by the user
- **Database Check**: `progress.completed_at !== null`
- **Use Case**:
  - Determines if checkpoint appears in completed list
  - Controls points calculation (only completed checkpoints count)
  - Determines next checkpoint to show
- **When Set**: 
  - When user clicks "Mark as Complete" button
- **NOT Set When**: 
  - Only unlocked
  - Only hints used

## Flag Relationships

```
hasProgress (any interaction)
  ├── isUnlocked (QR/GPS/code unlocked)
  │     └── isCompleted (user marked complete)
  └── hints_used > 0 (hints used before unlock)
```

## Implementation Guidelines

### ✅ DO:
- Always check `completed_at !== null` for completion
- Always check `unlocked_at !== null` for unlock status
- Always check if progress record exists for `hasProgress`
- Use explicit null checks: `p.completed_at !== null`
- Load points from `points_earned` when progress exists

### ❌ DON'T:
- Don't assume progress exists means unlocked
- Don't assume unlocked means completed
- Don't use truthy checks: `if (p.completed_at)` (null is falsy but we want explicit)
- Don't mix up hint usage with unlock status

## Component Responsibilities

### CheckpointPage
- **Flags Used**: `hasProgress`, `isUnlocked`
- **Responsibilities**:
  - Load checkpoint data
  - Check unlock status (`unlocked_at !== null`)
  - Track progress existence (`hasProgress`)
  - Handle unlock flow (QR/GPS/code)
  - Show HintsModal before unlock
  - Show ClueDisplay after unlock

### HintsModal
- **Flags Used**: `hasProgress` (implicit)
- **Responsibilities**:
  - Track individual hint usage (`hint1Used`, `hint2Used`, `hint3Used`)
  - Update `hints_used` count in database
  - Update `points_earned` when hints are used
  - Can be used before or after unlock
  - Sync points to parent component

### ClueDisplay
- **Flags Used**: `isUnlocked` (implicit - only shown when unlocked)
- **Responsibilities**:
  - Track individual hint usage
  - Allow marking checkpoint as complete
  - Set `completed_at` when complete
  - Finalize `points_earned` and `hints_used`

### HuntPage
- **Flags Used**: `isCompleted`
- **Responsibilities**:
  - Filter completed checkpoints (`completed_at !== null`)
  - Calculate total points (only from completed)
  - Find current checkpoint (first incomplete)

### MapPage
- **Flags Used**: `isCompleted`
- **Responsibilities**:
  - Show checkpoint status on map
  - Filter completed checkpoints (`completed_at !== null`)

### Leaderboard
- **Flags Used**: `isCompleted`, `isUnlocked`
- **Responsibilities**:
  - Count completed checkpoints (`completed_at !== null`)
  - Count unlocked checkpoints (`unlocked_at !== null`)
  - Sum points from completed only

## Database Schema

```sql
progress (
  team_id,
  checkpoint_id,
  unlocked_at,      -- NULL = not unlocked, timestamp = unlocked
  completed_at,     -- NULL = not completed, timestamp = completed
  hints_used,        -- 0-3, count of hints used
  points_earned      -- Final points (base - hint deductions)
)
```

## State Flow

### Scenario 1: Normal Flow (No Hints Before Unlock)
1. User scans QR → `unlocked_at` set → `isUnlocked = true`
2. User uses hints → `hints_used` incremented, `points_earned` updated
3. User marks complete → `completed_at` set → `isCompleted = true`

### Scenario 2: Hints Before Unlock
1. User uses hints → `hasProgress = true`, `unlocked_at = null`, `isUnlocked = false`
2. User scans QR → `unlocked_at` set → `isUnlocked = true`
3. User marks complete → `completed_at` set → `isCompleted = true`

### Scenario 3: Page Refresh
1. Load progress → Check `unlocked_at !== null` → Set `isUnlocked`
2. Load progress → Check `completed_at !== null` → Set `isCompleted`
3. Load hints → Restore individual hint states from `hints_used` count

## Key Functions

### Checking Completion
```typescript
const isCompleted = progressData?.completed_at !== null;
```

### Checking Unlock
```typescript
const isUnlocked = progressData?.unlocked_at !== null;
```

### Checking Progress Exists
```typescript
const hasProgress = progressData !== null && progressData !== undefined;
```

## Benefits

1. **Clear Separation**: Each flag has a single, clear purpose
2. **No Bottlenecks**: Flags are independent and don't block each other
3. **Predictable**: Always check the same way across all components
4. **Maintainable**: Easy to understand and debug
5. **Flexible**: Hints can be used before or after unlock
