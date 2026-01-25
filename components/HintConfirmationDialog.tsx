'use client';

interface HintConfirmationDialogProps {
  currentPoints: number;
  hintsUsed: number;
  hintsAvailable: number;
  hintCost: number; // Points deducted per hint
  onConfirm: () => void;
  onCancel: () => void;
}

export default function HintConfirmationDialog({
  currentPoints,
  hintsUsed,
  hintsAvailable,
  hintCost,
  onConfirm,
  onCancel,
}: HintConfirmationDialogProps) {
  const pointsAfterHint = Math.max(0, currentPoints - hintCost);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-md w-full animate-scale-in">
        <div className="text-center">
          <div className="text-5xl mb-4">💡</div>
          <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-3">
            Use a Hint?
          </h3>
          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 mb-4">
            <p className="text-gray-800 font-semibold mb-2">
              ⚠️ Warning: This will deduct {hintCost} points!
            </p>
            <div className="space-y-1 text-sm text-gray-700">
              <p>Current points: <span className="font-bold text-indigo-600">{currentPoints}</span></p>
              <p>Points after hint: <span className="font-bold text-red-600">{pointsAfterHint}</span></p>
              <p>Hints used: {hintsUsed} / 3</p>
              <p>Hints remaining: {hintsAvailable}</p>
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-6 py-3 bg-yellow-500 text-white rounded-lg font-semibold hover:bg-yellow-600 transition-colors"
            >
              Use Hint (-{hintCost} points)
            </button>
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
