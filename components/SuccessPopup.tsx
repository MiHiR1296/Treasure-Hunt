'use client';

import Confetti from './Confetti';

interface SuccessPopupProps {
  message?: string;
  onClose: () => void;
  autoCloseDelay?: number;
}

export default function SuccessPopup({ 
  message = 'Checkpoint Unlocked!', 
  onClose,
  autoCloseDelay 
}: SuccessPopupProps) {
  // Don't auto-close - require user to click button
  // Only auto-close if autoCloseDelay is explicitly set and > 0
  // But for checkpoint completion, we want manual close

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
          <button
            onClick={onClose}
            className="mt-6 w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg"
          >
            OK
          </button>
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
