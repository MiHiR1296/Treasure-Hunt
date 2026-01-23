'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTeam } from '@/lib/context/TeamContext';
import { supabase } from '@/lib/supabase/client';
import TeamPINInput from '@/components/TeamPINInput';

type Step = 'name' | 'choose' | 'create' | 'join';

export default function JoinPage() {
  const [step, setStep] = useState<Step>('name');
  const [userName, setUserName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { setTeam, setUser } = useTeam();
  const router = useRouter();

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError('');
    setStep('choose');
  };

  const handleChooseCreate = () => {
    setStep('create');
    setError('');
  };

  const handleChooseJoin = () => {
    setStep('join');
    setError('');
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!teamName.trim()) {
      setError('Please enter a team name');
      return;
    }

    if (pin.length !== 4) {
      setError('Please enter a 4-digit PIN');
      return;
    }

    setIsLoading(true);

    try {
      // Check if team name already exists
      const { data: existingTeam } = await supabase
        .from('teams')
        .select('id, name')
        .eq('name', teamName.trim())
        .single();

      if (existingTeam) {
        setError('Team name already exists. Please choose a different name or join the existing team.');
        setIsLoading(false);
        return;
      }

      // Create new team with PIN
      const { data: newTeam, error: teamError } = await supabase
        .from('teams')
        .insert({ 
          name: teamName.trim(),
          pin: pin
        })
        .select('id, name, pin')
        .single();

      if (teamError) throw teamError;

      // Create user and link to team
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          name: userName.trim(),
          team_id: newTeam.id
        })
        .select('id, name, team_id')
        .single();

      if (userError) {
        // If users table doesn't exist yet, continue without user
        console.warn('Could not create user:', userError);
      } else {
        // Update team with created_by_user_id
        await supabase
          .from('teams')
          .update({ created_by_user_id: newUser.id })
          .eq('id', newTeam.id);
      }

      // Store in context
      setTeam({ id: newTeam.id, name: newTeam.name });
      if (newUser) {
        setUser(newUser);
      }

      // Redirect to hunts list
      router.push('/hunts');
    } catch (err: any) {
      console.error('Error creating team:', err);
      setError(err.message || 'Failed to create team. Please try again.');
      setIsLoading(false);
    }
  };

  const handleJoinTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!teamName.trim()) {
      setError('Please enter a team name');
      return;
    }

    if (pin.length !== 4) {
      setError('Please enter a 4-digit PIN');
      return;
    }

    setIsLoading(true);

    try {
      // Find team by name and PIN
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('id, name, pin')
        .eq('name', teamName.trim())
        .single();

      if (teamError || !team) {
        setError('Team not found. Please check the team name.');
        setIsLoading(false);
        return;
      }

      // Verify PIN
      if (team.pin !== pin) {
        setError('Incorrect PIN. Please try again.');
        setIsLoading(false);
        return;
      }

      // Create user and link to team
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          name: userName.trim(),
          team_id: team.id
        })
        .select('id, name, team_id')
        .single();

      if (userError) {
        // If users table doesn't exist yet, continue without user
        console.warn('Could not create user:', userError);
      }

      // Store in context
      setTeam({ id: team.id, name: team.name });
      if (newUser) {
        setUser(newUser);
      }

      // Redirect to hunts list
      router.push('/hunts');
    } catch (err: any) {
      console.error('Error joining team:', err);
      setError(err.message || 'Failed to join team. Please try again.');
      setIsLoading(false);
    }
  };

  const goBack = () => {
    if (step === 'choose') {
      setStep('name');
    } else if (step === 'create' || step === 'join') {
      setStep('choose');
    }
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 md:p-8">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`w-3 h-3 rounded-full ${step === 'name' ? 'bg-indigo-600' : 'bg-green-500'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'choose' ? 'bg-indigo-600' : step === 'create' || step === 'join' ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'create' || step === 'join' ? 'bg-indigo-600' : 'bg-gray-300'}`} />
        </div>

        {/* Step 1: Enter Name */}
        {step === 'name' && (
          <>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
              Join the Hunt
            </h1>
            <p className="text-gray-600 text-center mb-6 text-sm md:text-base">
              Start by entering your name
            </p>

            <form onSubmit={handleNameSubmit} className="space-y-4">
              <div>
                <label htmlFor="userName" className="block text-sm font-medium text-gray-700 mb-2">
                  Your Name
                </label>
                <input
                  id="userName"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g., John Doe"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base text-gray-900 bg-white"
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
                disabled={isLoading || !userName.trim()}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                Continue →
              </button>
            </form>
          </>
        )}

        {/* Step 2: Choose Create or Join */}
        {step === 'choose' && (
          <>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
              Create or Join Team?
            </h1>
            <p className="text-gray-600 text-center mb-6 text-sm md:text-base">
              Hi {userName}! Choose an option below
            </p>

            <div className="space-y-4">
              <button
                onClick={handleChooseCreate}
                disabled={isLoading}
                className="w-full bg-green-600 text-white py-4 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 text-base"
              >
                🆕 Create New Team
              </button>

              <button
                onClick={handleChooseJoin}
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 text-base"
              >
                👥 Join Existing Team
              </button>

              <button
                onClick={goBack}
                className="w-full text-gray-600 py-2 text-sm hover:text-gray-800"
              >
                ← Back
              </button>
            </div>
          </>
        )}

        {/* Step 3a: Create Team */}
        {step === 'create' && (
          <>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
              Create Team
            </h1>
            <p className="text-gray-600 text-center mb-6 text-sm md:text-base">
              Set up your team with a name and PIN
            </p>

            <form onSubmit={handleCreateTeam} className="space-y-4">
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
                <TeamPINInput
                  value={pin}
                  onChange={setPin}
                  label="Set Team PIN (4 digits)"
                  placeholder="Enter a 4-digit PIN for your team"
                  disabled={isLoading}
                />
                <p className="mt-2 text-xs text-gray-500">
                  Share this PIN with your team members so they can join
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !teamName.trim() || pin.length !== 4}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                {isLoading ? 'Creating...' : 'Create Team'}
              </button>

              <button
                type="button"
                onClick={goBack}
                className="w-full text-gray-600 py-2 text-sm hover:text-gray-800"
              >
                ← Back
              </button>
            </form>
          </>
        )}

        {/* Step 3b: Join Team */}
        {step === 'join' && (
          <>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
              Join Team
            </h1>
            <p className="text-gray-600 text-center mb-6 text-sm md:text-base">
              Enter the team name and PIN
            </p>

            <form onSubmit={handleJoinTeam} className="space-y-4">
              <div>
                <label htmlFor="joinTeamName" className="block text-sm font-medium text-gray-700 mb-2">
                  Team Name
                </label>
                <input
                  id="joinTeamName"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Enter the team name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base text-gray-900 bg-white"
                  disabled={isLoading}
                  autoFocus
                />
              </div>

              <div>
                <TeamPINInput
                  value={pin}
                  onChange={setPin}
                  label="Team PIN"
                  placeholder="Enter the 4-digit PIN"
                  disabled={isLoading}
                  error={error && error.includes('PIN') ? error : undefined}
                />
              </div>

              {error && !error.includes('PIN') && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !teamName.trim() || pin.length !== 4}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                {isLoading ? 'Joining...' : 'Join Team'}
              </button>

              <button
                type="button"
                onClick={goBack}
                className="w-full text-gray-600 py-2 text-sm hover:text-gray-800"
              >
                ← Back
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
