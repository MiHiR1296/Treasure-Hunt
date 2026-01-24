'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import Leaderboard from '@/components/Leaderboard';

export default function AdminLeaderboardPage() {
  const params = useParams();
  const huntId = params.huntId as string;
  const [huntName, setHuntName] = useState('');
  const [totalCheckpoints, setTotalCheckpoints] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadHuntData();
  }, [huntId]);

  const loadHuntData = async () => {
    try {
      setIsLoading(true);
      
      // Load hunt name
      const { data: huntData, error: huntError } = await supabase
        .from('hunts')
        .select('name')
        .eq('id', huntId)
        .single();

      if (huntError) {
        console.error('Error loading hunt:', huntError);
      } else if (huntData) {
        setHuntName(huntData.name);
      }

      // Load total checkpoints
      const { count } = await supabase
        .from('checkpoints')
        .select('*', { count: 'exact', head: true })
        .eq('hunt_id', huntId);

      setTotalCheckpoints(count || 0);
    } catch (err) {
      console.error('Error loading hunt data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <p className="text-gray-600 text-center">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Leaderboard</h1>
              {huntName && (
                <p className="text-gray-600 mt-1">{huntName}</p>
              )}
            </div>
            <Link
              href="/admin"
              className="text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              ← Back to Admin Panel
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
