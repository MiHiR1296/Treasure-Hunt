'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTeam } from '@/lib/context/TeamContext';
import { supabase } from '@/lib/supabase/client';

export default function JoinPage() {
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<string[]>(['', '', '', '']); // Start with 4 empty slots
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { setTeam } = useTeam();
  const router = useRouter();

  const MIN_MEMBERS = 4;
  const MAX_MEMBERS = 6;

  const handleMemberChange = (index: number, value: string) => {
    const newMembers = [...members];
    newMembers[index] = value;
    setMembers(newMembers);
  };

  const addMemberSlot = () => {
    if (members.length < MAX_MEMBERS) {
      setMembers([...members, '']);
    }
  };

  const removeMemberSlot = (index: number) => {
    if (members.length > MIN_MEMBERS) {
      const newMembers = members.filter((_, i) => i !== index);
      setMembers(newMembers);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!teamName.trim()) {
      setError('Please enter a team name');
      return;
    }

    const validMembers = members.filter(m => m.trim() !== '');
    if (validMembers.length < MIN_MEMBERS) {
      setError(`Please enter at least ${MIN_MEMBERS} team members`);
      return;
    }

    if (validMembers.length > MAX_MEMBERS) {
      setError(`Maximum ${MAX_MEMBERS} team members allowed`);
      return;
    }

    setIsLoading(true);

    try {
      // Check if team name already exists
      const { data: existing } = await supabase
        .from('teams')
        .select('id, name')
        .eq('name', teamName.trim())
        .single();

      let teamId: string;
      let teamNameFinal: string;

      if (existing) {
        teamId = existing.id;
        teamNameFinal = existing.name;
      } else {
        // Create new team
        const { data: newTeam, error: insertError } = await supabase
          .from('teams')
          .insert({ name: teamName.trim() })
          .select('id, name')
          .single();

        if (insertError) {
          throw insertError;
        }

        teamId = newTeam.id;
        teamNameFinal = newTeam.name;
      }

      // Add team members
      const membersToInsert = validMembers.map((name, index) => ({
        team_id: teamId,
        name: name.trim(),
        order_index: index + 1,
      }));

      const { error: membersError } = await supabase
        .from('team_members')
        .insert(membersToInsert);

      if (membersError) {
        // If team_members table doesn't exist yet, that's okay - continue
        console.warn('Could not save team members:', membersError);
      }

      // Store team in context and localStorage
      setTeam({ id: teamId, name: teamNameFinal });

      // Redirect to hunts list
      router.push('/hunts');
    } catch (err: any) {
      console.error('Error joining:', err);
      setError(err.message || 'Failed to join. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const validMembersCount = members.filter(m => m.trim() !== '').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
          Join the Hunt
        </h1>
        <p className="text-gray-600 text-center mb-2 text-sm md:text-base">
          Enter your team name and members
        </p>
        <p className="text-gray-500 text-center mb-6 text-xs md:text-sm">
          Minimum {MIN_MEMBERS} members, Maximum {MAX_MEMBERS} members
        </p>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 mb-2">
              Team Name
            </label>
            <input
              id="teamName"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g., The Explorers"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base text-gray-900 bg-white"
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Team Members ({validMembersCount} / {MIN_MEMBERS}-{MAX_MEMBERS})
            </label>
            <div className="space-y-2">
              {members.map((member, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={member}
                    onChange={(e) => handleMemberChange(index, e.target.value)}
                    placeholder={`Member ${index + 1} name`}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base text-gray-900 bg-white"
                    disabled={isLoading}
                  />
                  {members.length > MIN_MEMBERS && (
                    <button
                      type="button"
                      onClick={() => removeMemberSlot(index)}
                      className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-semibold"
                      disabled={isLoading}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {members.length < MAX_MEMBERS && (
              <button
                type="button"
                onClick={addMemberSlot}
                className="mt-2 w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-semibold"
                disabled={isLoading}
              >
                + Add Member
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || validMembersCount < MIN_MEMBERS}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {isLoading ? 'Joining...' : 'Join Hunt'}
          </button>
        </form>

        <p className="mt-4 text-xs md:text-sm text-gray-500 text-center">
          Your team name will be visible on the leaderboard
        </p>
      </div>
    </div>
  );
}
