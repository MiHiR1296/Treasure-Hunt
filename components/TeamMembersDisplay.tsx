'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

interface TeamMember {
  user_id: string;
  user_name: string;
}

export default function TeamMembersDisplay() {
  const { team, user } = useTeam();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (team) {
      loadTeamMembers();
      
      // Subscribe to realtime updates for team members
      const channel = supabase
        .channel(`team-members:${team.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'users',
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
        .eq('team_id', team.id)
        .order('name', { ascending: true });

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

      const memberList: TeamMember[] = teamUsers.map((teamUser) => ({
        user_id: teamUser.id,
        user_name: teamUser.name,
      }));

      setMembers(memberList);
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
      <div className="bg-white rounded-xl shadow-lg p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Team Members</h3>
        <p className="text-gray-500 text-center py-2 text-sm">Loading...</p>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-4">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Team Members</h3>
        <p className="text-gray-500 text-center py-2 text-sm">No team members found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-4">
      <h3 className="text-sm font-bold text-gray-900 mb-3">Team Members</h3>
      <div className="space-y-2">
        {members.map((member) => {
          const isCurrentUser = user?.id === member.user_id;
          return (
            <div
              key={member.user_id}
              className={`p-2 rounded-lg border ${
                isCurrentUser
                  ? 'bg-indigo-50 border-indigo-300'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <span className={`text-sm font-medium ${isCurrentUser ? 'text-indigo-700' : 'text-gray-900'}`}>
                {member.user_name}
                {isCurrentUser && ' (You)'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
