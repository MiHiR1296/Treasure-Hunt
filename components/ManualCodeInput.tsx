'use client';

import { useState } from 'react';

interface ManualCodeInputProps {
  onCodeSubmit: (code: string) => void;
  isLoading?: boolean;
}

export default function ManualCodeInput({ onCodeSubmit, isLoading }: ManualCodeInputProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code.trim()) {
      setError('Please enter a code');
      return;
    }

    onCodeSubmit(code.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div>
        <input
          id="code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
          }}
          placeholder="Enter code..."
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-center text-lg font-mono text-gray-900 bg-white"
          disabled={isLoading}
          autoFocus
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Checking...' : 'Submit Code'}
      </button>
    </form>
  );
}
