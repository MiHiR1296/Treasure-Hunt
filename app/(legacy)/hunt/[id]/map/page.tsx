'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

// Dynamically import MapView to avoid SSR issues with Leaflet
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

interface Checkpoint {
  id: string;
  title: string;
  lat: number | null;
  lng: number | null;
  order_index: number;
  isCompleted?: boolean;
  isCurrent?: boolean;
}

export default function MapPage() {
  const params = useParams();
  const huntId = params.id as string;
  const { team } = useTeam();

  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [completedCheckpoints, setCompletedCheckpoints] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCheckpoints();
  }, [huntId, team]);

  const loadCheckpoints = async () => {
    try {
      // Load checkpoints
      const { data: checkpointsData, error: checkpointsError } = await supabase
        .from('checkpoints')
        .select('id, title, lat, lng, order_index')
        .eq('hunt_id', huntId)
        .order('order_index', { ascending: true });

      if (checkpointsError) throw checkpointsError;

      // Load progress
      let completed = new Set<string>();
      if (team) {
        const { data: progressData } = await supabase
          .from('progress')
          .select('checkpoint_id, completed_at')
          .eq('team_id', team.id);

        // Only include checkpoints that are actually completed (have completed_at)
        completed = new Set(
          progressData
            ?.filter((p) => p.completed_at !== null)
            .map((p) => p.checkpoint_id) || []
        );
        setCompletedCheckpoints(completed);
      }

      // Mark checkpoints
      const marked = (checkpointsData || []).map((cp) => {
        const isCompleted = completed.has(cp.id);
        const isCurrent = !isCompleted && checkpointsData?.findIndex((c) => c.id === cp.id) === completed.size;
        return { ...cp, isCompleted, isCurrent };
      });

      setCheckpoints(marked);
    } catch (err) {
      console.error('Error loading checkpoints:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate center from checkpoints
  const center: [number, number] | undefined = checkpoints.length > 0 && checkpoints[0].lat && checkpoints[0].lng
    ? [checkpoints[0].lat, checkpoints[0].lng]
    : undefined;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Map View</h1>
            <Link
              href={`/hunt/${huntId}`}
              className="text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              ← Back to Hunt
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <p className="text-gray-600">Loading map...</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-4">
            <div className="h-[600px] w-full">
              <MapView checkpoints={checkpoints} center={center} zoom={14} />
            </div>
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">Legend:</p>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  <span>Completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                  <span>Current</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
                  <span>Locked</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
