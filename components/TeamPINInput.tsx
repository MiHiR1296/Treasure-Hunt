'use client';

import { useState, useRef, useEffect } from 'react';

interface TeamPINInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  error?: string;
}

export default function TeamPINInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  placeholder = 'Enter 4-digit PIN',
  label = 'Team PIN',
  error,
}: TeamPINInputProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Sync value prop to digits
    if (value && value.length === 4) {
      setDigits(value.split(''));
    } else if (!value) {
      setDigits(['', '', '', '']);
    }
  }, [value]);

  const handleDigitChange = (index: number, digit: string) => {
    // Only allow digits
    if (digit && !/^\d$/.test(digit)) {
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    const pinValue = newDigits.join('');
    onChange(pinValue);

    // Auto-focus next input
    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Call onComplete when all 4 digits are entered
    if (pinValue.length === 4 && onComplete) {
      setTimeout(() => onComplete(), 100);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').slice(0, 4);
    if (/^\d{1,4}$/.test(pasted)) {
      const newDigits = pasted.split('').concat(Array(4 - pasted.length).fill(''));
      setDigits(newDigits.slice(0, 4));
      onChange(pasted.padEnd(4, '').slice(0, 4));
      if (pasted.length === 4 && onComplete) {
        setTimeout(() => onComplete(), 100);
      }
    }
  };

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}
      <div className="flex gap-2 justify-center">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => (inputRefs.current[index] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            disabled={disabled}
            className="w-14 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="0"
          />
        ))}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
      )}
      {!error && value.length < 4 && (
        <p className="mt-2 text-xs text-gray-500 text-center">{placeholder}</p>
      )}
    </div>
  );
}
