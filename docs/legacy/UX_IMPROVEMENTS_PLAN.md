# UX Improvements and Points System - Implementation Plan

## Overview

Comprehensive UX improvements based on user feedback:
1. Points-based scoring (20 points per checkpoint, -5 per hint)
2. Improved animations and visual feedback
3. Better error handling with fun popups
4. Confetti celebration on correct answers
5. Enhanced checkpoint flow
6. Game tips section
7. Admin panel improvements

## Database Changes

1. Add `points` column to `checkpoints` (default 20)
2. Add `points_earned` and `hints_used` to `progress` table
3. Calculate total points per team for leaderboard

## Component Changes

### Hunt Page
- Change "Unlock This Checkpoint" → "Start" or "Begin"
- Remove "View Map" button
- Add checkpoint completion animation
- Add Game Tips section

### Checkpoint Page
- Remove confusing unlock text
- Remove clue/hint display after unlock
- Implement hint system (3 max, -5 points each)
- Show points remaining
- Fun error popup
- Confetti on correct answer
- Change button text

### Admin Panel
- Rename "Title" to "Question"
- Fix faint text colors

### Leaderboard
- Show and sort by points
