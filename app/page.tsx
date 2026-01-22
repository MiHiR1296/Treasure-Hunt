import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center">
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            🎯 Republic Day Treasure Hunt
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Lokdhara, Kalyan East, Maharashtra
          </p>
          <p className="text-gray-500">
            Explore iconic local spots and find the hidden treasure!
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h2 className="font-semibold text-gray-900 mb-2">How to Play</h2>
            <ul className="text-left text-gray-700 space-y-1 text-sm">
              <li>• Form a team and choose a team name</li>
              <li>• Visit checkpoints at iconic locations</li>
              <li>• Unlock clues using QR codes, GPS, or secret codes</li>
              <li>• Solve riddles to find the next checkpoint</li>
              <li>• Be the first to find the treasure!</li>
            </ul>
          </div>
        </div>

        <Link
          href="/join"
          className="inline-block bg-indigo-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-indigo-700 transition-colors shadow-lg"
        >
          Join the Hunt
        </Link>

        <p className="mt-6 text-sm text-gray-500">
          Open to all ages • Free to participate
        </p>
      </div>
    </div>
  );
}
