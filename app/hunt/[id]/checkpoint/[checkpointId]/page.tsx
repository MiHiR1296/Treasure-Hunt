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
import SuccessPopup from '@/components/SuccessPopup';
import HintsModal from '@/components/HintsModal';
import QRScannerModal from '@/components/QRScannerModal';

interface Checkpoint {
  id: string;
  hunt_id?: string;
  title: string;
  description: string | null;
  clue_text?: string; // Kept for backward compatibility
  hint_text?: string | null; // Kept for backward compatibility
  hint_1?: string | null;
  hint_2?: string | null;
  hint_3?: string | null;
  unlock_method: 'qr_code' | 'gps' | 'manual_code';
  qr_code_value: string | null;
  qr_code_image_url?: string | null;
  is_dud_qr?: boolean;
  dud_message?: string | null;
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
  const [hasProgress, setHasProgress] = useState(false); // Track if any progress record exists (for hints)
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showHintsModal, setShowHintsModal] = useState(false);
  const [showQRScannerModal, setShowQRScannerModal] = useState(false);
  const [currentPoints, setCurrentPoints] = useState(20);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [dudQrMessage, setDudQrMessage] = useState<string | null>(null);

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
        .select('*, hunt_id')
        .eq('id', checkpointId)
        .single();

      if (fetchError) throw fetchError;
      setCheckpoint(data);
      setCurrentPoints(data.points || 20);
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
        .select('checkpoint_id, points_earned, hints_used, unlocked_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      if (data) {
        // Track if progress exists (for hints functionality)
        setHasProgress(true);
        
        // Only consider unlocked if unlocked_at is not null
        // (hints can be used before unlocking, creating a progress record with unlocked_at: null)
        if (data.unlocked_at !== null) {
          setIsUnlocked(true);
          // Load current points if checkpoint is already unlocked
          if (data.points_earned !== undefined && data.points_earned !== null) {
            setCurrentPoints(data.points_earned);
          }
        }
      } else {
        setHasProgress(false);
      }
    } catch (err) {
      // Not unlocked yet, no progress
      setHasProgress(false);
    }
  };

  const handleUnlock = async () => {
    if (!team || !checkpoint || isUnlocking) return;

    setIsUnlocking(true);
    setError('');
    setShowErrorPopup(false);

    try {
      const basePoints = checkpoint.points || 20;
      
      // Check if progress already exists (might have been created when hints were used)
      const { data: existingProgress } = await supabase
        .from('progress')
        .select('id, points_earned, hints_used')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      if (existingProgress) {
        // Progress exists - check if already unlocked
        if (existingProgress.hints_used !== undefined && existingProgress.points_earned !== undefined) {
          // Hints were used before unlocking, preserve the existing points
          console.log('Progress exists with hints used, preserving points:', existingProgress);
          // Update to mark as unlocked, but keep existing points_earned
          await supabase
            .from('progress')
            .update({
              unlocked_at: new Date().toISOString(),
            })
            .eq('team_id', team.id)
            .eq('checkpoint_id', checkpointId);
          
          // Update current points display to match what's in DB
          setCurrentPoints(existingProgress.points_earned);
        } else {
          // Already unlocked, just show success
          console.log('Checkpoint already unlocked, showing success popup');
          setIsUnlocked(true);
          setShowSuccessPopup(true);
          setIsUnlocking(false);
          return;
        }
      } else {
        // No progress exists, create new record
        console.log('Unlocking checkpoint...', { teamId: team.id, checkpointId, basePoints });

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

        if (progressError) {
          // If it's a duplicate key error, that's okay - just proceed
          if (progressError.code === '23505') {
            console.log('Progress already exists (duplicate key), proceeding...');
          } else {
            console.error('Progress insert error:', progressError);
            throw progressError;
          }
        }
      }

      console.log('Checkpoint unlocked successfully!');

      // Update state to reflect unlock
      setIsUnlocked(true);

      // Show success popup, then redirect
      setShowSuccessPopup(true);
    } catch (err: any) {
      console.error('Error unlocking checkpoint:', err);
      setError(err.message || 'Failed to unlock checkpoint');
      setShowErrorPopup(true);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleSuccessPopupClose = () => {
    setShowSuccessPopup(false);
    // Don't redirect - let user stay on checkpoint page to complete it
    // User will manually navigate away when ready
  };

  const handleQRScan = async (decodedText: string) => {
    if (!checkpoint) return;

    const scannedValue = decodedText.trim();
    const expectedValue = checkpoint.qr_code_value?.trim();

    // Check if scanned QR is a dud QR
    // First check if this checkpoint itself is a dud QR
    if (checkpoint.is_dud_qr && scannedValue === expectedValue) {
      setDudQrMessage(checkpoint.dud_message || 'Try again! This is not the right QR code.');
      setShowErrorPopup(true);
      setShowQRScannerModal(false);
      return;
    }

    // Check if scanned QR matches any dud QR in the dud_qr_codes table
    try {
      const { data: dudQRCodes } = await supabase
        .from('dud_qr_codes')
        .select('dud_message')
        .eq('hunt_id', checkpoint.hunt_id || '')
        .eq('qr_code_value', scannedValue)
        .limit(1);

      if (dudQRCodes && dudQRCodes.length > 0) {
        setDudQrMessage(dudQRCodes[0].dud_message || 'Try again! This is not the right QR code.');
        setShowErrorPopup(true);
        setShowQRScannerModal(false);
        return;
      }
    } catch (err) {
      // Continue with validation if check fails
    }

    // Also check legacy dud checkpoints (for backward compatibility)
    try {
      const { data: dudCheckpoints } = await supabase
        .from('checkpoints')
        .select('dud_message')
        .eq('hunt_id', checkpoint.hunt_id || '')
        .eq('is_dud_qr', true)
        .eq('qr_code_value', scannedValue)
        .limit(1);

      if (dudCheckpoints && dudCheckpoints.length > 0) {
        setDudQrMessage(dudCheckpoints[0].dud_message || 'Try again! This is not the right QR code.');
        setShowErrorPopup(true);
        setShowQRScannerModal(false);
        return;
      }
    } catch (err) {
      // Continue with validation if check fails
    }

    // Validate QR code
    if (scannedValue === expectedValue) {
      setError(''); // Clear any previous errors
      setShowErrorPopup(false); // Close error popup if open
      setShowQRScannerModal(false);
      handleUnlock();
    } else {
      setShowErrorPopup(true);
      setShowQRScannerModal(false);
    }
  };

  const handleCodeSubmit = (code: string) => {
    if (!checkpoint) return;

    // Trim and normalize both codes for comparison
    const enteredCode = code.trim().toLowerCase();
    const expectedCode = checkpoint.manual_code?.trim().toLowerCase();

    console.log('Code comparison:', { enteredCode, expectedCode, match: enteredCode === expectedCode });

    if (enteredCode === expectedCode) {
      setError(''); // Clear any previous errors
      setShowErrorPopup(false); // Close error popup if open
      handleUnlock();
    } else {
      console.log('Code mismatch - showing error popup');
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
    // Puzzles are complete - but this doesn't complete the checkpoint
    // User still needs to unlock the checkpoint (scan QR, enter code, etc.)
    // and then complete it via ClueDisplay
    // Just show a message that puzzles are done - no popup needed
    // The puzzle chain component will show its own completion message
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

  const hasHints = checkpoint.hint_1 || checkpoint.hint_2 || checkpoint.hint_3;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-3 md:p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6 lg:p-8 space-y-4 md:space-y-6 relative">
          {/* Points Display - Top Right */}
          <div className="absolute top-4 right-4">
            <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2 rounded-lg shadow-lg">
              <p className="text-xs opacity-90">Points</p>
              <p className="text-2xl font-bold">{currentPoints}</p>
            </div>
          </div>

          <div className="pr-24">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{checkpoint.title}</h1>
            {checkpoint.description && (
              <p className="text-sm md:text-base text-gray-600 mb-4">{checkpoint.description}</p>
            )}
          </div>

          {/* Show Hints Button - Before Unlock (hints can always be used before unlock) */}
          {hasHints && !isUnlocked && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
              <button
                onClick={() => setShowHintsModal(true)}
                className="w-full bg-yellow-500 text-white py-3 rounded-lg font-semibold hover:bg-yellow-600 transition-colors text-base"
              >
                💡 Show Hints for This Checkpoint
              </button>
              <p className="text-xs text-yellow-700 mt-2 text-center">
                Each hint costs 5 points. You can use up to 3 hints.
              </p>
            </div>
          )}

          {/* QR Scanner Button - Always Visible for QR Code Checkpoints */}
          {checkpoint.unlock_method === 'qr_code' && !isUnlocked && (
            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-4 mb-4">
              <button
                onClick={() => setShowQRScannerModal(true)}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors text-base flex items-center justify-center gap-2"
              >
                📷 Scan QR Code
              </button>
              <p className="text-xs text-indigo-700 mt-2 text-center">
                Scan the QR code at the checkpoint location to unlock
              </p>
            </div>
          )}

          {!isUnlocked ? (
            <div className="space-y-4 md:space-y-6">
              {/* Show puzzle chain if exists (optional hints to QR location) */}
              {checkpoint.use_puzzle_chain && (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                  <p className="text-sm text-blue-800 mb-3">
                    💡 These puzzles will help you find the QR code location. You can skip them and scan the QR code directly if you already know where it is.
                  </p>
                  <PuzzleChainRenderer
                    checkpointId={checkpointId}
                    onComplete={handlePuzzleChainComplete}
                  />
                </div>
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
                <ManualCodeInput onCodeSubmit={handleCodeSubmit} isLoading={isUnlocking} />
              )}
            </div>
          ) : (
            // After unlock, show question/hints interface
            <ClueDisplay
              checkpointId={checkpointId}
              hint1={checkpoint.hint_1}
              hint2={checkpoint.hint_2}
              hint3={checkpoint.hint_3}
              onNext={handleNext}
              checkpointPoints={checkpoint.points || 20}
            />
          )}

          {showSuccessPopup && (
            <SuccessPopup
              message="Checkpoint Unlocked!"
              onClose={handleSuccessPopupClose}
            />
          )}

          {showHintsModal && (
            <HintsModal
              checkpointId={checkpointId}
              hint1={checkpoint.hint_1}
              hint2={checkpoint.hint_2}
              hint3={checkpoint.hint_3}
              checkpointPoints={checkpoint.points || 20}
              onClose={() => setShowHintsModal(false)}
              onPointsUpdate={setCurrentPoints}
            />
          )}

          {showErrorPopup && !showSuccessPopup && (
            <ErrorPopup
              message={dudQrMessage || "Incorrect code. Please try again."}
              onClose={() => {
                setShowErrorPopup(false);
                setDudQrMessage(null);
              }}
              onTryAgain={() => {
                setShowErrorPopup(false);
                setDudQrMessage(null);
                if (checkpoint?.unlock_method === 'qr_code') {
                  setShowQRScannerModal(true);
                }
              }}
            />
          )}

          {showQRScannerModal && checkpoint.unlock_method === 'qr_code' && (
            <QRScannerModal
              isOpen={showQRScannerModal}
              onClose={() => setShowQRScannerModal(false)}
              onScanSuccess={handleQRScan}
              expectedValue={checkpoint.qr_code_value || undefined}
              isDudQr={checkpoint.is_dud_qr}
              dudMessage={checkpoint.dud_message || undefined}
            />
          )}

          {error && !showSuccessPopup && !showErrorPopup && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-red-700">
              <p className="font-semibold">Error:</p>
              <p>{error}</p>
            </div>
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
