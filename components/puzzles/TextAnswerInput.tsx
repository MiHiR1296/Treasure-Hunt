'use client';

import { useState } from 'react';

interface TextAnswerInputProps {
  onAnswerSubmit: (answer: string) => void;
  placeholder?: string;
}

export default function TextAnswerInput({ onAnswerSubmit, placeholder = 'Enter your answer...' }: TextAnswerInputProps) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) {
      setError('Please enter an answer');
      return;
    }
    setError('');
    const submittedAnswer = answer.trim();
    setAnswer(''); // Clear input
    onAnswerSubmit(submittedAnswer);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <input
          type="text"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setError('');
          }}
          placeholder={placeholder}
          className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none text-lg font-medium text-gray-900 bg-white placeholder:text-gray-500"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
      <button
        type="submit"
        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
      >
        Submit Answer
      </button>
    </form>
  );
}
