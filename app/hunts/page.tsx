'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';

interface Hunt {
  id: string;
  name: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
}

export default function HuntsPage() {
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { team, isLoading: teamLoading } = useTeam();
  const router = useRouter();

  useEffect(() => {
    if (!teamLoading && !team) {
      router.push('/join');
      return;
    }

    loadHunts();
  }, [team, teamLoading, router]);

  const loadHunts = async () => {
    try {
      const { data, error } = await supabase
        .from('hunts')
        .select('*')
        .eq('status', 'live')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHunts(data || []);
    } catch (err) {
      console.error('Error loading hunts:', err);
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

  if (!team) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Available Hunts</h1>
          <p className="text-gray-600">Team: <span className="font-semibold">{team.name}</span></p>
        </div>

        {hunts.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <p className="text-gray-600">No active hunts at the moment.</p>
            <p className="text-sm text-gray-500 mt-2">Check back soon!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {hunts.map((hunt) => (
              <Link
                key={hunt.id}
                href={`/hunt/${hunt.id}`}
                className="block bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow"
              >
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{hunt.name}</h2>
                {hunt.description && (
                  <p className="text-gray-600 mb-4">{hunt.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {hunt.starts_at && (
                    <span>Starts: {new Date(hunt.starts_at).toLocaleString()}</span>
                  )}
                  {hunt.ends_at && (
                    <span>Ends: {new Date(hunt.ends_at).toLocaleString()}</span>
                  )}
                </div>
                <div className="mt-4 text-indigo-600 font-semibold">
                  View Hunt →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
