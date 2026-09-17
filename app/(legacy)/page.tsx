'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTeam } from '@/lib/context/TeamContext';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { team, isLoading } = useTeam();
  const router = useRouter();
  const [hasTeam, setHasTeam] = useState(false);

  useEffect(() => {
    if (!isLoading && team) {
      setHasTeam(true);
    } else {
      setHasTeam(false);
    }
  }, [team, isLoading]);

  const handleContinueHunt = () => {
    router.push('/hunts');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center">
        <div className="mb-8">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <div className="relative w-48 h-48 md:w-56 md:h-56">
              <Image
                src="/logo.png"
                alt="Kanchanjanga CHS Treasure Hunt Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            The Grand Kanchanjanga Quest
          </h1>
          <p className="text-xl text-gray-700 mb-2 font-semibold">
            Kanchanjanga Society
          </p>
          <p className="text-lg text-gray-600 mb-3">
            A Republic Day Treasure Hunt Experience 🇮🇳
          </p>
          <p className="text-base text-gray-600">
            Join us for our annual 2026 community event! This treasure hunt brings everyone together for an exciting day of adventure, fun, and friendly competition. Connect with neighbors, explore your community, and create lasting memories together.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h2 className="font-semibold text-gray-900 mb-2">How to Play</h2>
            <ul className="text-left text-gray-700 space-y-1 text-sm">
              <li>• Form a team and choose a team name</li>
              <li>• Visit checkpoints at designated locations</li>
              <li>• Scan QR codes to unlock clues and puzzles</li>
              <li>• Solve challenges to reveal the next checkpoint</li>
              <li>• Complete all checkpoints and top the leaderboard!</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          {hasTeam && (
            <button
              onClick={handleContinueHunt}
              className="w-full bg-green-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-700 transition-colors shadow-lg"
            >
              🎮 Continue Hunt
            </button>
          )}
          
          <Link
            href="/join"
            className={`inline-block w-full ${hasTeam ? 'bg-indigo-600' : 'bg-indigo-600'} text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-indigo-700 transition-colors shadow-lg`}
          >
            {hasTeam ? 'Join/Create New Team' : 'Join the Hunt'}
          </Link>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          Open to all ages • Free to participate
        </p>
      </div>
    </div>
  );
}
