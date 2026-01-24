'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

interface TeamMemberStats {
  user_id: string;
  user_name: string;
  individual_points: number;
  checkpoints_completed: number;
}

export default function TeamMembersDisplay() {
  const { team, user } = useTeam();
  const [members, setMembers] = useState<TeamMemberStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (team) {
      loadTeamMembers();
      
      // Subscribe to realtime updates
      const channel = supabase
        .channel(`team-members:${team.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'progress',
            filter: `team_id=eq.${team.id}`,
          },
          () => {
            loadTeamMembers();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [team]);

  const loadTeamMembers = async () => {
    if (!team) return;

    try {
      setIsLoading(true);

      // Get all users in this team
      const { data: teamUsers, error: usersError } = await supabase
        .from('users')
        .select('id, name')
        .eq('team_id', team.id);

      if (usersError) {
        console.error('Error loading team users:', usersError);
        setMembers([]);
        setIsLoading(false);
        return;
      }

      if (!teamUsers || teamUsers.length === 0) {
        setMembers([]);
        setIsLoading(false);
        return;
      }

      // Get all progress for this team with user_id
      const { data: progressData, error: progressError } = await supabase
        .from('progress')
        .select('user_id, individual_points_earned, completed_at')
        .eq('team_id', team.id)
        .not('user_id', 'is', null);

      if (progressError) {
        console.error('Error loading progress:', progressError);
      }

      // Calculate individual stats for each user
      const memberStats: TeamMemberStats[] = teamUsers.map((teamUser) => {
        const userProgress = progressData?.filter((p) => p.user_id === teamUser.id) || [];
        const individualPoints = userProgress.reduce((sum, p) => {
          if (p.completed_at && p.individual_points_earned) {
            return sum + p.individual_points_earned;
          }
          return sum;
        }, 0);
        const checkpointsCompleted = userProgress.filter((p) => p.completed_at).length;

        return {
          user_id: teamUser.id,
          user_name: teamUser.name,
          individual_points: individualPoints,
          checkpoints_completed: checkpointsCompleted,
        };
      });

      // Sort by points descending
      memberStats.sort((a, b) => b.individual_points - a.individual_points);

      setMembers(memberStats);
    } catch (err) {
      console.error('Error loading team members:', err);
      setMembers([]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!team) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
        <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-4">Team Members</h3>
        <p className="text-gray-500 text-center py-4">Loading team members...</p>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
        <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-4">Team Members</h3>
        <p className="text-gray-500 text-center py-4">No team members found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
      <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-4">Team Members</h3>
      <div className="space-y-3">
        {members.map((member) => {
          const isCurrentUser = user?.id === member.user_id;
          return (
            <div
              key={member.user_id}
              className={`p-3 rounded-lg border-2 ${
                isCurrentUser
                  ? 'bg-indigo-50 border-indigo-300'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`font-semibold ${isCurrentUser ? 'text-indigo-700' : 'text-gray-900'}`}>
                    {member.user_name}
                    {isCurrentUser && ' (You)'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">
                    {member.individual_points} pts
                  </div>
                  <div className="text-xs text-gray-600">
                    {member.checkpoints_completed} completed
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
