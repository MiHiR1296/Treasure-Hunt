'use client';

import { useEffect } from 'react';
import Confetti from './Confetti';

interface SuccessPopupProps {
  message?: string;
  onClose: () => void;
  autoCloseDelay?: number;
}

export default function SuccessPopup({ 
  message = 'Checkpoint Unlocked!', 
  onClose,
  autoCloseDelay = 2500 
}: SuccessPopupProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, autoCloseDelay);

    return () => clearTimeout(timer);
  }, [onClose, autoCloseDelay]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-md w-full animate-scale-in relative">
        <Confetti trigger={true} />
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🎉</div>
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
            {message}
          </h3>
          <p className="text-gray-600 mb-4">
            Great job! You've unlocked this checkpoint.
          </p>
          <div className="mt-6">
            <div className="inline-block animate-spin text-indigo-600 text-4xl">⏳</div>
            <p className="text-sm text-gray-500 mt-2">Redirecting...</p>
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes scale-in {
          from {
            transform: scale(0.8);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-scale-in {
          animation: scale-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
