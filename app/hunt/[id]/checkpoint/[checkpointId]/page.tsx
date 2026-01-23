'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import QRScanner from '@/components/QRScanner';
import GPSDetector from '@/components/GPSDetector';
import ManualCodeInput from '@/components/ManualCodeInput';
import ClueDisplay from '@/components/ClueDisplay';
import PuzzleChainRenderer from '@/components/puzzles/PuzzleChainRenderer';
import ErrorPopup from '@/components/ErrorPopup';

interface Checkpoint {
  id: string;
  title: string;
  description: string | null;
  clue_text: string;
  hint_text: string | null;
  unlock_method: 'qr_code' | 'gps' | 'manual_code';
  qr_code_value: string | null;
  manual_code: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  use_puzzle_chain?: boolean;
  points?: number;
}

export default function CheckpointPage() {
  const params = useParams();
  const router = useRouter();
  const huntId = params.id as string;
  const checkpointId = params.checkpointId as string;
  const { team } = useTeam();

  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showErrorPopup, setShowErrorPopup] = useState(false);

  useEffect(() => {
    if (!team) {
      router.push('/join');
      return;
    }

    loadCheckpoint();
    checkIfUnlocked();
  }, [team, checkpointId, router]);

  const loadCheckpoint = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('checkpoints')
        .select('*')
        .eq('id', checkpointId)
        .single();

      if (fetchError) throw fetchError;
      setCheckpoint(data);
    } catch (err: any) {
      console.error('Error loading checkpoint:', err);
      setError(err.message || 'Failed to load checkpoint');
    } finally {
      setIsLoading(false);
    }
  };

  const checkIfUnlocked = async () => {
    if (!team) return;

    try {
      const { data } = await supabase
        .from('progress')
        .select('checkpoint_id')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .single();

      if (data) {
        setIsUnlocked(true);
      }
    } catch (err) {
      // Not unlocked yet
    }
  };

  const handleUnlock = async () => {
    if (!team || !checkpoint) return;

    try {
      const basePoints = checkpoint.points || 20;
      
      // Record progress with initial points (will be updated when completed)
      const { error: progressError } = await supabase
        .from('progress')
        .insert({
          team_id: team.id,
          checkpoint_id: checkpointId,
          unlocked_at: new Date().toISOString(),
          points_earned: basePoints, // Start with full points, will deduct for hints
          hints_used: 0,
        });

      if (progressError) throw progressError;

      setIsUnlocked(true);
    } catch (err: any) {
      console.error('Error unlocking checkpoint:', err);
      setError(err.message || 'Failed to unlock checkpoint');
    }
  };

  const handleQRScan = (decodedText: string) => {
    if (!checkpoint) return;

    if (decodedText === checkpoint.qr_code_value) {
      setError(''); // Clear any previous errors
      setShowErrorPopup(false); // Close error popup if open
      handleUnlock();
    } else {
      setShowErrorPopup(true);
    }
  };

  const handleCodeSubmit = (code: string) => {
    if (!checkpoint) return;

    if (code.toLowerCase() === checkpoint.manual_code?.toLowerCase()) {
      setError(''); // Clear any previous errors
      setShowErrorPopup(false); // Close error popup if open
      handleUnlock();
    } else {
      setShowErrorPopup(true);
    }
  };

  const handleGPSUnlock = () => {
    handleUnlock();
  };

  const handleNext = () => {
    router.push(`/hunt/${huntId}`);
  };

  const handlePuzzleChainComplete = () => {
    // Puzzle chain completion is handled by PuzzleChainRenderer
    // Just navigate back to hunt page
    router.push(`/hunt/${huntId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <p className="text-gray-600">Loading checkpoint...</p>
      </div>
    );
  }

  if (!checkpoint) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <p className="text-red-600">Checkpoint not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-3 md:p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{checkpoint.title}</h1>
            {checkpoint.description && (
              <p className="text-sm md:text-base text-gray-600 mb-4">{checkpoint.description}</p>
            )}
          </div>

          {/* Hints Section - Show before unlocking */}
          {checkpoint.hint_text && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 md:p-6">
              <div className="flex items-start gap-3">
                <div className="text-2xl">💡</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-yellow-900 mb-2">Hints Available</h3>
                  <p className="text-sm text-yellow-800 mb-3">
                    This checkpoint has hints available. You can use up to 3 hints, but each hint will deduct 5 points from your total.
                  </p>
                  {!isUnlocked && (
                    <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-3">
                      <p className="text-sm text-yellow-900 font-medium">
                        🔒 Unlock this checkpoint to access hints
                      </p>
                    </div>
                  )}
                  {isUnlocked && (
                    <div className="bg-green-100 border border-green-300 rounded-lg p-3">
                      <p className="text-sm text-green-900 font-medium">
                        ✅ Checkpoint unlocked! Hints are now available below.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isUnlocked ? (
            <div className="space-y-4 md:space-y-6">
              {checkpoint.unlock_method === 'qr_code' && (
                <QRScanner onScanSuccess={handleQRScan} onError={() => setShowErrorPopup(true)} />
              )}

              {checkpoint.unlock_method === 'gps' && checkpoint.lat && checkpoint.lng && (
                <GPSDetector
                  targetLat={checkpoint.lat}
                  targetLng={checkpoint.lng}
                  radiusMeters={checkpoint.radius_m}
                  onUnlock={handleGPSUnlock}
                />
              )}

              {checkpoint.unlock_method === 'manual_code' && (
                <ManualCodeInput onCodeSubmit={handleCodeSubmit} />
              )}
            </div>
          ) : (
            checkpoint.use_puzzle_chain ? (
              <PuzzleChainRenderer
                checkpointId={checkpointId}
                onComplete={handlePuzzleChainComplete}
              />
            ) : (
              <ClueDisplay
                checkpointId={checkpointId}
                hintText={checkpoint.hint_text}
                onNext={handleNext}
                checkpointPoints={checkpoint.points || 20}
              />
            )
          )}

          {showErrorPopup && (
            <ErrorPopup
              message="Incorrect code. Please try again."
              onClose={() => setShowErrorPopup(false)}
              onTryAgain={() => setShowErrorPopup(false)}
            />
          )}

          <div className="pt-4 border-t">
            <button
              onClick={() => router.push(`/hunt/${huntId}`)}
              className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm md:text-base"
            >
              ← Back to Hunt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
