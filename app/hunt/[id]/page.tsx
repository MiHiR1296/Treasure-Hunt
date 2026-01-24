'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import ProgressBar from '@/components/ProgressBar';
import Leaderboard from '@/components/Leaderboard';
import GameTips from '@/components/GameTips';
import TeamMembersDisplay from '@/components/TeamMembersDisplay';

interface Checkpoint {
  id: string;
  title: string;
  description: string | null;
  order_index: number;
  lat: number | null;
  lng: number | null;
}

interface Hunt {
  id: string;
  name: string;
  description: string | null;
}

export default function HuntPage() {
  const params = useParams();
  const router = useRouter();
  const huntId = params.id as string;
  const { team, isLoading: teamLoading } = useTeam();

  const [hunt, setHunt] = useState<Hunt | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [completedCheckpoints, setCompletedCheckpoints] = useState<Set<string>>(new Set());
  const [currentCheckpoint, setCurrentCheckpoint] = useState<Checkpoint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newlyCompleted, setNewlyCompleted] = useState<Set<string>>(new Set());
  const [teamPoints, setTeamPoints] = useState(0);

  useEffect(() => {
    if (!teamLoading && !team) {
      router.push('/join');
      return;
    }

    if (team) {
      loadHuntData();
    }
  }, [team, teamLoading, huntId, router]);

  // Check for newly completed checkpoints on mount (after returning from checkpoint)
  useEffect(() => {
    if (team && checkpoints.length > 0) {
      checkForNewCompletions();
    }
  }, [team, checkpoints]);

  const loadHuntData = async () => {
    try {
      // Load hunt
      const { data: huntData, error: huntError } = await supabase
        .from('hunts')
        .select('*')
        .eq('id', huntId)
        .single();

      if (huntError) throw huntError;
      setHunt(huntData);

      // Load checkpoints
      const { data: checkpointsData, error: checkpointsError } = await supabase
        .from('checkpoints')
        .select('*')
        .eq('hunt_id', huntId)
        .order('order_index', { ascending: true });

      if (checkpointsError) throw checkpointsError;
      setCheckpoints(checkpointsData || []);

      // Load progress
      if (team) {
        const { data: progressData } = await supabase
          .from('progress')
          .select('checkpoint_id, completed_at, points_earned')
          .eq('team_id', team.id);

        const completed = new Set(progressData?.map((p) => p.checkpoint_id) || []);
        setCompletedCheckpoints(completed);

        // Calculate total team points from completed checkpoints
        const totalPoints = progressData
          ?.filter((p) => p.completed_at)
          .reduce((sum, p) => sum + (p.points_earned || 0), 0) || 0;
        setTeamPoints(totalPoints);

        // Find current checkpoint (first incomplete)
        const current = checkpointsData?.find((cp) => !completed.has(cp.id));
        setCurrentCheckpoint(current || null);
      }
    } catch (err) {
      console.error('Error loading hunt:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const checkForNewCompletions = async () => {
    if (!team) return;

    try {
      const { data: progressData } = await supabase
        .from('progress')
        .select('checkpoint_id, completed_at')
        .eq('team_id', team.id)
        .not('completed_at', 'is', null);

      const newlyCompletedSet = new Set<string>();
      progressData?.forEach((p) => {
        // Check if completed recently (within last 10 seconds)
        const completedTime = new Date(p.completed_at).getTime();
        const now = Date.now();
        if (now - completedTime < 10000) {
          newlyCompletedSet.add(p.checkpoint_id);
        }
      });

      if (newlyCompletedSet.size > 0) {
        setNewlyCompleted(newlyCompletedSet);
        // Clear animation after 3 seconds
        setTimeout(() => {
          setNewlyCompleted(new Set());
        }, 3000);
      }
    } catch (err) {
      console.error('Error checking completions:', err);
    }
  };

  if (teamLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!team || !hunt) {
    return null;
  }

  const totalCheckpoints = checkpoints.length;
  const completedCount = completedCheckpoints.size;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-3 md:p-4">
      <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{hunt.name}</h1>
          {hunt.description && (
            <p className="text-sm md:text-base text-gray-600 mb-4">{hunt.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs md:text-sm text-gray-500">
            <span>Team: <span className="font-semibold text-gray-900">{team.name}</span></span>
            <span>•</span>
            <span>Points: <span className="font-semibold text-indigo-600">{teamPoints}</span></span>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
          <ProgressBar current={completedCount} total={totalCheckpoints} />
        </div>

        {/* Two-column layout: Checkpoints on left, Leaderboard + Team Members on right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left column: Checkpoints */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Completed Checkpoints List */}
            {checkpoints
              .filter((cp) => completedCheckpoints.has(cp.id))
              .map((cp) => (
                <div
                  key={cp.id}
                  className={`bg-white rounded-2xl shadow-xl p-4 md:p-6 transition-all duration-500 ${
                    newlyCompleted.has(cp.id)
                      ? 'animate-checkmark-in border-2 border-green-400'
                      : 'border border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {newlyCompleted.has(cp.id) ? (
                      <div className="text-3xl animate-bounce">✅</div>
                    ) : (
                      <div className="text-2xl">✓</div>
                    )}
                    <div className="flex-1">
                      <h3 className="text-lg md:text-xl font-semibold text-gray-800 line-through opacity-60">
                        {cp.order_index}. {cp.title}
                      </h3>
                      {cp.description && (
                        <p className="text-sm text-gray-500 line-through opacity-60">{cp.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

            {/* Current Checkpoint */}
            {currentCheckpoint ? (
              <div
                className={`bg-white rounded-2xl shadow-xl p-4 md:p-6 transition-all duration-500 ${
                  newlyCompleted.size > 0
                    ? 'animate-fade-in-scale border-2 border-indigo-400'
                    : ''
                }`}
              >
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Current Checkpoint</h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg md:text-xl font-semibold text-gray-800 mb-2">
                      {currentCheckpoint.order_index}. {currentCheckpoint.title}
                    </h3>
                    {currentCheckpoint.description && (
                      <p className="text-sm md:text-base text-gray-600 mb-4">{currentCheckpoint.description}</p>
                    )}
                  </div>
                  <Link
                    href={`/hunt/${huntId}/checkpoint/${currentCheckpoint.id}`}
                    className="block w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors text-center text-base"
                  >
                    Start →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border-2 border-green-200 rounded-2xl shadow-xl p-6 md:p-8 text-center">
                <h2 className="text-xl md:text-2xl font-bold text-green-900 mb-2">🎉 Congratulations!</h2>
                <p className="text-sm md:text-base text-green-800">You've completed all checkpoints!</p>
              </div>
            )}

            {/* Quick Actions */}
            <div className="flex justify-center">
              <Link
                href={`/hunt/${huntId}/leaderboard`}
                className="bg-white rounded-xl shadow-lg p-4 md:p-6 hover:shadow-xl transition-shadow text-center min-w-[200px]"
              >
                <span className="text-2xl mb-2 block">🏆</span>
                <span className="font-semibold text-gray-900 text-sm md:text-base">Leaderboard</span>
              </Link>
            </div>
          </div>

          {/* Right column: Leaderboard + Team Members */}
          <div className="lg:col-span-1 space-y-4 md:space-y-6">
            {/* Leaderboard Widget */}
            <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
              <Leaderboard huntId={huntId} totalCheckpoints={totalCheckpoints} compact />
            </div>

            {/* Team Members */}
            <TeamMembersDisplay />
          </div>
        </div>

        {/* Game Tips */}
        <GameTips />
      </div>
      <style jsx>{`
        @keyframes checkmark-in {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes fade-in-scale {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-checkmark-in {
          animation: checkmark-in 0.6s ease-out;
        }
        .animate-fade-in-scale {
          animation: fade-in-scale 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
