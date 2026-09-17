'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import Leaderboard from '@/components/Leaderboard';

export default function LeaderboardPage() {
  const params = useParams();
  const huntId = params.id as string;
  const [totalCheckpoints, setTotalCheckpoints] = useState(0);

  useEffect(() => {
    loadTotalCheckpoints();
  }, [huntId]);

  const loadTotalCheckpoints = async () => {
    try {
      const { count } = await supabase
        .from('checkpoints')
        .select('*', { count: 'exact', head: true })
        .eq('hunt_id', huntId);

      setTotalCheckpoints(count || 0);
    } catch (err) {
      console.error('Error loading total checkpoints:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Leaderboard</h1>
            <Link
              href={`/hunt/${huntId}`}
              className="text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              ← Back to Hunt
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <Leaderboard huntId={huntId} totalCheckpoints={totalCheckpoints} />
        </div>
      </div>
    </div>
  );
}
