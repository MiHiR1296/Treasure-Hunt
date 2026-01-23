'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

interface LeaderboardEntry {
  team_id: string;
  team_name: string;
  checkpoints_completed: number;
  total_points: number;
  last_completed_at: string | null;
}

interface LeaderboardProps {
  huntId: string;
  totalCheckpoints: number;
  compact?: boolean;
}

export default function Leaderboard({ huntId, totalCheckpoints, compact = false }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { team } = useTeam();

  useEffect(() => {
    loadLeaderboard();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`leaderboard:${huntId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'progress',
        },
        () => {
          loadLeaderboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [huntId]);

  const loadLeaderboard = async () => {
    try {
      // Get all checkpoints for this hunt
      const { data: checkpoints, error: checkpointsError } = await supabase
        .from('checkpoints')
        .select('id')
        .eq('hunt_id', huntId);

      if (checkpointsError) {
        console.error('Error loading checkpoints:', checkpointsError);
      }

      if (!checkpoints || checkpoints.length === 0) {
        setEntries([]);
        setIsLoading(false);
        return;
      }

      const checkpointIds = checkpoints.map((cp) => cp.id);

      // Get all teams that have progress in this hunt (teams that have started)
      // First get all teams with progress, then get their team info
      const { data: progressData, error: progressError } = await supabase
        .from('progress')
        .select('team_id, checkpoint_id, completed_at, unlocked_at, points_earned')
        .in('checkpoint_id', checkpointIds);

      if (progressError) {
        console.error('Error loading progress:', progressError);
      }

      // Get unique team IDs from progress
      const teamIdsWithProgress = new Set(progressData?.map(p => p.team_id) || []);
      
      // Get all teams (or just teams with progress)
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('id, name');

      if (teamsError) {
        console.error('Error loading teams:', teamsError);
      }

      if (!teams || teams.length === 0) {
        setEntries([]);
        setIsLoading(false);
        return;
      }

      // Calculate progress for each team that has started (has progress)
      const teamProgress: Record<string, LeaderboardEntry> = {};

      teams.forEach((team) => {
        // Only include teams that have started (have at least one progress entry)
        if (teamIdsWithProgress.has(team.id)) {
          const teamProgressData = progressData?.filter((p) => p.team_id === team.id) || [];
          const completedCheckpoints = teamProgressData.filter((p) => p.completed_at).length;
          const totalPoints = teamProgressData.reduce((sum, p) => {
            // Only count points from completed checkpoints
            if (p.completed_at && p.points_earned) {
              return sum + p.points_earned;
            }
            return sum;
          }, 0);
          const lastCompleted = teamProgressData
            .map((p) => p.completed_at || p.unlocked_at)
            .filter(Boolean)
            .sort()
            .reverse()[0] || null;

          teamProgress[team.id] = {
            team_id: team.id,
            team_name: team.name,
            checkpoints_completed: completedCheckpoints,
            total_points: totalPoints,
            last_completed_at: lastCompleted,
          };
        }
      });

      // Sort by total points (desc), then by checkpoints completed (desc), then by last completed time (asc)
      const sorted = Object.values(teamProgress).sort((a, b) => {
        // First sort by points
        if (b.total_points !== a.total_points) {
          return b.total_points - a.total_points;
        }
        // Then by checkpoints completed
        if (b.checkpoints_completed !== a.checkpoints_completed) {
          return b.checkpoints_completed - a.checkpoints_completed;
        }
        // Finally by time
        if (!a.last_completed_at) return 1;
        if (!b.last_completed_at) return -1;
        return new Date(a.last_completed_at).getTime() - new Date(b.last_completed_at).getTime();
      });

      setEntries(sorted);
    } catch (err) {
      console.error('Error loading leaderboard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-4">
        <p className="text-gray-500">Loading leaderboard...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-gray-500">No teams yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && (
        <h3 className="text-xl font-bold text-gray-900 mb-4">Leaderboard</h3>
      )}
      <div className="space-y-2">
        {entries.map((entry, index) => {
          const isCurrentTeam = team?.id === entry.team_id;
          const rank = index + 1;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

          return (
            <div
              key={entry.team_id}
              className={`p-3 rounded-lg border-2 ${
                isCurrentTeam
                  ? 'bg-indigo-50 border-indigo-300'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-gray-700">{medal}</span>
                  <span className={`font-semibold ${isCurrentTeam ? 'text-indigo-700' : 'text-gray-900'}`}>
                    {entry.team_name}
                    {isCurrentTeam && ' (You)'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">
                    {entry.total_points} pts
                  </div>
                  <div className="text-xs text-gray-600">
                    {entry.checkpoints_completed} / {totalCheckpoints}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
