'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import ProgressBar from '@/components/ProgressBar';
import Leaderboard from '@/components/Leaderboard';

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

  useEffect(() => {
    if (!teamLoading && !team) {
      router.push('/join');
      return;
    }

    if (team) {
      loadHuntData();
    }
  }, [team, teamLoading, huntId, router]);

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
          .select('checkpoint_id')
          .eq('team_id', team.id);

        const completed = new Set(progressData?.map((p) => p.checkpoint_id) || []);
        setCompletedCheckpoints(completed);

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{hunt.name}</h1>
          {hunt.description && (
            <p className="text-gray-600 mb-4">{hunt.description}</p>
          )}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>Team: <span className="font-semibold">{team.name}</span></span>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <ProgressBar current={completedCount} total={totalCheckpoints} />
        </div>

        {/* Current Checkpoint */}
        {currentCheckpoint ? (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Current Checkpoint</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">
                  {currentCheckpoint.order_index}. {currentCheckpoint.title}
                </h3>
                {currentCheckpoint.description && (
                  <p className="text-gray-600 mb-4">{currentCheckpoint.description}</p>
                )}
              </div>
              <Link
                href={`/hunt/${huntId}/checkpoint/${currentCheckpoint.id}`}
                className="block w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors text-center"
              >
                Unlock This Checkpoint →
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-green-50 border-2 border-green-200 rounded-2xl shadow-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-green-900 mb-2">🎉 Congratulations!</h2>
            <p className="text-green-800">You've completed all checkpoints!</p>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href={`/hunt/${huntId}/map`}
            className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow text-center"
          >
            <span className="text-2xl mb-2 block">🗺️</span>
            <span className="font-semibold text-gray-900">View Map</span>
          </Link>
          <Link
            href={`/hunt/${huntId}/leaderboard`}
            className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow text-center"
          >
            <span className="text-2xl mb-2 block">🏆</span>
            <span className="font-semibold text-gray-900">Leaderboard</span>
          </Link>
        </div>

        {/* Leaderboard Widget */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <Leaderboard huntId={huntId} totalCheckpoints={totalCheckpoints} compact />
        </div>
      </div>
    </div>
  );
}
