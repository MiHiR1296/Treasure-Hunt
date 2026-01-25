'use client';

import { useState, useEffect } from 'react';

const tips = [
  {
    icon: '🧠',
    title: 'Think Before You Act',
    message: 'Your brain is mightier than rushing! Take a moment to analyze the clues carefully.',
  },
  {
    icon: '👥',
    title: 'Teamwork Makes the Dream Work',
    message: 'Discuss with your team - different perspectives can reveal hidden solutions!',
  },
  {
    icon: '🔍',
    title: 'Details Matter',
    message: 'Look closely at everything - sometimes the answer is in the smallest details.',
  },
  {
    icon: '💡',
    title: 'Hints Cost Points',
    message: 'Use hints wisely! Each hint costs points (configurable per checkpoint). Think carefully before using them.',
  },
  {
    icon: '🎯',
    title: 'Stay Focused',
    message: 'Keep your eyes on the prize! Stay calm and work through each checkpoint methodically.',
  },
  {
    icon: '🤝',
    title: 'Be Respectful',
    message: 'Remember to be kind and respectful to others. This is a fun adventure for everyone!',
  },
  {
    icon: '⏱️',
    title: 'Time Management',
    message: 'Balance speed with accuracy. Rushing can lead to mistakes, but don\'t take too long!',
  },
  {
    icon: '🎉',
    title: 'Have Fun!',
    message: 'This is a treasure hunt - enjoy the journey, celebrate small wins, and have a great time!',
  },
];

export default function GameTips() {
  const [currentTip, setCurrentTip] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setCurrentTip((prev) => (prev + 1) % tips.length);
        setIsVisible(true);
      }, 300);
    }, 5000); // Change tip every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const tip = tips[currentTip];

  return (
    <div className="bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-2xl shadow-xl p-6 md:p-8">
      <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 text-center">
        💫 Game Tips & Tricks
      </h3>
      <div
        className={`transition-all duration-300 ${
          isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="text-center">
          <div className="text-5xl mb-3">{tip.icon}</div>
          <h4 className="text-lg md:text-xl font-semibold text-gray-900 mb-2">
            {tip.title}
          </h4>
          <p className="text-gray-700 text-sm md:text-base">
            {tip.message}
          </p>
        </div>
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {tips.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              setIsVisible(false);
              setTimeout(() => {
                setCurrentTip(index);
                setIsVisible(true);
              }, 300);
            }}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentTip
                ? 'bg-purple-600 w-8'
                : 'bg-purple-300 hover:bg-purple-400'
            }`}
            aria-label={`Tip ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
