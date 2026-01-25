'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import QRScanner from '@/components/QRScanner';
import GPSDetector from '@/components/GPSDetector';
import ManualCodeInput from '@/components/ManualCodeInput';
import ClueDisplay from '@/components/ClueDisplay';
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
  hint_cost?: number;
}

export default function CheckpointPage() {
  const params = useParams();
  const router = useRouter();
  const huntId = params.id as string;
  const checkpointId = params.checkpointId as string;
  const { team } = useTeam();

  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  // State flags - clear separation of concerns
  const [isUnlocked, setIsUnlocked] = useState(false); // True when unlocked_at is not null (QR/code/GPS unlocked)
  const [hasProgress, setHasProgress] = useState(false); // True when any progress record exists (for hints tracking)
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
        
        // Load points if available (hints may have been used before unlock)
        if (data.points_earned !== undefined && data.points_earned !== null) {
          setCurrentPoints(data.points_earned);
        }
        
        // Only consider unlocked if unlocked_at is not null
        // (hints can be used before unlocking, creating a progress record with unlocked_at: null)
        if (data.unlocked_at !== null) {
          setIsUnlocked(true);
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
        .select('id, points_earned, hints_used, unlocked_at')
        .eq('team_id', team.id)
        .eq('checkpoint_id', checkpointId)
        .maybeSingle();

      // Clear flag check: If already unlocked, just show success
      if (existingProgress && existingProgress.unlocked_at !== null) {
        console.log('Checkpoint already unlocked');
        setIsUnlocked(true);
        setHasProgress(true);
        if (existingProgress.points_earned !== null && existingProgress.points_earned !== undefined) {
          setCurrentPoints(existingProgress.points_earned);
        }
        setShowSuccessPopup(true);
        setIsUnlocking(false);
        return;
      }

      // Progress exists but not unlocked (hints were used before unlock)
      if (existingProgress) {
        console.log('Progress exists with hints used, unlocking now...', existingProgress);
        // Update to mark as unlocked, preserve existing points_earned and hints_used
        const { error: updateError } = await supabase
          .from('progress')
          .update({
            unlocked_at: new Date().toISOString(),
            // Keep existing points_earned and hints_used
          })
          .eq('team_id', team.id)
          .eq('checkpoint_id', checkpointId);
        
        if (updateError) {
          console.error('Error updating progress to unlocked:', updateError);
          throw updateError;
        }
        
        // Verify the update was successful by querying again
        // Retry verification up to 3 times to handle database propagation delays
        let verifyData = null;
        let retries = 0;
        const maxRetries = 3;
        
        while (retries < maxRetries) {
          const { data, error: verifyError } = await supabase
            .from('progress')
            .select('unlocked_at, points_earned')
            .eq('team_id', team.id)
            .eq('checkpoint_id', checkpointId)
            .single();
          
          if (verifyError) {
            console.error('Error verifying unlock status:', verifyError);
            break;
          }
          
          verifyData = data;
          
          if (verifyData && verifyData.unlocked_at !== null) {
            // Successfully unlocked
            break;
          }
          
          // Wait a bit before retrying
          if (retries < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          retries++;
        }
        
        if (!verifyData || verifyData.unlocked_at === null) {
          console.warn('Update completed but unlocked_at is still null after retries - this may indicate a database issue');
          // Still proceed - the update should have worked, might be a caching issue
        }
        
        // Update current points display to match what's in DB
        if (existingProgress.points_earned !== null && existingProgress.points_earned !== undefined) {
          setCurrentPoints(existingProgress.points_earned);
        } else {
          setCurrentPoints(basePoints);
        }
      } else {
        // No progress exists, create new record
        console.log('Unlocking checkpoint...', { teamId: team.id, checkpointId, basePoints });

        // Record progress with initial points (will be updated when hints are used or completed)
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

      // Set unlocked state optimistically for immediate UI update
      setIsUnlocked(true);
      setHasProgress(true);

      // Refresh unlock status from database to ensure consistency
      // This is especially important when hints were used before unlock
      await checkIfUnlocked();

      // Show success popup
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

  // Note: Puzzles are now used as hints after unlock, not before
  // This handler is kept for backward compatibility but not used
  const handlePuzzleChainComplete = () => {
    // Puzzles are now shown as hints in ClueDisplay after unlock
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
                Each hint costs {checkpoint.hint_cost || 5} points. You can use up to 3 hints.
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
              {/* Puzzles are now shown as hints after unlock, not before */}
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
              usePuzzleChain={checkpoint.use_puzzle_chain || false}
              onNext={handleNext}
              checkpointPoints={checkpoint.points || 20}
              hintCost={checkpoint.hint_cost || 5}
              isUnlocked={isUnlocked}
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
              hintCost={checkpoint.hint_cost || 5}
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
