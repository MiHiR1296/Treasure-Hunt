'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTeam } from '@/lib/context/TeamContext';
import { supabase } from '@/lib/supabase/client';

export default function JoinPage() {
  const [teamName, setTeamName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { setTeam } = useTeam();
  const router = useRouter();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!teamName.trim()) {
      setError('Please enter a team name');
      setIsLoading(false);
      return;
    }

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
        // Team exists, use it
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">
          Join the Hunt
        </h1>
        <p className="text-gray-600 text-center mb-6">
          Enter your team name to get started
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Joining...' : 'Join Hunt'}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-500 text-center">
          Your team name will be visible on the leaderboard
        </p>
      </div>
    </div>
  );
}
