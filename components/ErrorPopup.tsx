'use client';

interface ErrorPopupProps {
  message: string;
  onClose: () => void;
  onTryAgain?: () => void;
}

export default function ErrorPopup({ message, onClose, onTryAgain }: ErrorPopupProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-md w-full animate-scale-in">
        <div className="text-center">
          <div className="text-6xl mb-4">😅</div>
          <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-3">
            Oops!
          </h3>
          <p className="text-gray-700 mb-6 text-base md:text-lg">
            {message}
          </p>
          <div className="flex gap-3 justify-center">
            {onTryAgain && (
              <button
                onClick={onTryAgain}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
              >
                Try Again
              </button>
            )}
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              OK
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
