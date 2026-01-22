'use client';

interface TextClueProps {
  clueText: string;
}

export default function TextClue({ clueText }: TextClueProps) {
  return (
    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">Clue:</h3>
      <p className="text-gray-800 text-lg leading-relaxed whitespace-pre-line">
        {clueText}
      </p>
    </div>
  );
}
