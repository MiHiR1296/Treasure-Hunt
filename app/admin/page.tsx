'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Admin password - change this in production!
// You can set NEXT_PUBLIC_ADMIN_PASSWORD in .env.local, or it defaults to 'admin123'
const ADMIN_PASSWORD = typeof window !== 'undefined' 
  ? (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'admin123')
  : 'admin123';

interface Hunt {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

interface Checkpoint {
  id: string;
  title: string;
  order_index: number;
  unlock_method: string;
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [selectedHunt, setSelectedHunt] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form states for creating hunt
  const [huntName, setHuntName] = useState('');
  const [huntDescription, setHuntDescription] = useState('');
  const [huntStatus, setHuntStatus] = useState('draft');

  // Form states for creating checkpoint
  const [checkpointTitle, setCheckpointTitle] = useState('');
  const [checkpointDescription, setCheckpointDescription] = useState('');
  const [checkpointOrder, setCheckpointOrder] = useState(1);
  const [checkpointClue, setCheckpointClue] = useState('');
  const [checkpointHint, setCheckpointHint] = useState('');
  const [checkpointUnlockMethod, setCheckpointUnlockMethod] = useState<'qr_code' | 'gps' | 'manual_code'>('manual_code');
  const [checkpointQRCode, setCheckpointQRCode] = useState('');
  const [checkpointManualCode, setCheckpointManualCode] = useState('');
  const [checkpointLat, setCheckpointLat] = useState('');
  const [checkpointLng, setCheckpointLng] = useState('');
  const [checkpointRadius, setCheckpointRadius] = useState('50');

  useEffect(() => {
    if (isAuthenticated) {
      loadHunts();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedHunt) {
      loadCheckpoints();
    }
  }, [selectedHunt]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert('Incorrect password');
    }
  };

  const loadHunts = async () => {
    try {
      const { data, error } = await supabase
        .from('hunts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHunts(data || []);
    } catch (err) {
      console.error('Error loading hunts:', err);
      alert('Failed to load hunts');
    }
  };

  const loadCheckpoints = async () => {
    if (!selectedHunt) return;

    try {
      const { data, error } = await supabase
        .from('checkpoints')
        .select('*')
        .eq('hunt_id', selectedHunt)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setCheckpoints(data || []);
    } catch (err) {
      console.error('Error loading checkpoints:', err);
    }
  };

  const handleCreateHunt = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('hunts')
        .insert({
          name: huntName,
          description: huntDescription || null,
          status: huntStatus,
        })
        .select()
        .single();

      if (error) throw error;

      alert('Hunt created successfully!');
      setHuntName('');
      setHuntDescription('');
      setHuntStatus('draft');
      loadHunts();
    } catch (err: any) {
      console.error('Error creating hunt:', err);
      const errorMessage = err?.message || err?.error?.message || JSON.stringify(err) || 'Failed to create hunt';
      console.error('Full error details:', {
        message: err?.message,
        error: err?.error,
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        fullError: err
      });
      alert(`Error: ${errorMessage}\n\nCheck browser console for details.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHunt) {
      alert('Please select a hunt first');
      return;
    }

    setIsLoading(true);

    try {
      const checkpointData: any = {
        hunt_id: selectedHunt,
        title: checkpointTitle,
        description: checkpointDescription || null,
        order_index: checkpointOrder,
        clue_text: checkpointClue,
        hint_text: checkpointHint || null,
        unlock_method: checkpointUnlockMethod,
      };

      if (checkpointUnlockMethod === 'qr_code') {
        checkpointData.qr_code_value = checkpointQRCode;
      } else if (checkpointUnlockMethod === 'manual_code') {
        checkpointData.manual_code = checkpointManualCode;
      } else if (checkpointUnlockMethod === 'gps') {
        checkpointData.lat = parseFloat(checkpointLat);
        checkpointData.lng = parseFloat(checkpointLng);
        checkpointData.radius_m = parseInt(checkpointRadius) || 50;
      }

      const { error } = await supabase.from('checkpoints').insert(checkpointData);

      if (error) throw error;

      alert('Checkpoint created successfully!');
      // Reset form
      setCheckpointTitle('');
      setCheckpointDescription('');
      setCheckpointOrder(checkpointOrder + 1);
      setCheckpointClue('');
      setCheckpointHint('');
      setCheckpointQRCode('');
      setCheckpointManualCode('');
      setCheckpointLat('');
      setCheckpointLng('');
      setCheckpointRadius('50');
      loadCheckpoints();
    } catch (err: any) {
      console.error('Error creating checkpoint:', err);
      alert(err.message || 'Failed to create checkpoint');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">Admin Login</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Admin Panel</h1>
          <button
            onClick={() => setIsAuthenticated(false)}
            className="text-red-600 hover:text-red-700 font-semibold"
          >
            Logout
          </button>
        </div>

        {/* Create Hunt */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Create New Hunt</h2>
          <form onSubmit={handleCreateHunt} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Hunt Name</label>
              <input
                type="text"
                value={huntName}
                onChange={(e) => setHuntName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={huntDescription}
                onChange={(e) => setHuntDescription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={huntStatus}
                onChange={(e) => setHuntStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="draft">Draft</option>
                <option value="live">Live</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              Create Hunt
            </button>
          </form>
        </div>

        {/* Select Hunt */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Select Hunt</h2>
          <select
            value={selectedHunt || ''}
            onChange={(e) => setSelectedHunt(e.target.value || null)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">-- Select a hunt --</option>
            {hunts.map((hunt) => (
              <option key={hunt.id} value={hunt.id}>
                {hunt.name} ({hunt.status})
              </option>
            ))}
          </select>
        </div>

        {/* Create Checkpoint */}
        {selectedHunt && (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Create Checkpoint</h2>
            <form onSubmit={handleCreateCheckpoint} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <input
                    type="text"
                    value={checkpointTitle}
                    onChange={(e) => setCheckpointTitle(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Order Index</label>
                  <input
                    type="number"
                    value={checkpointOrder}
                    onChange={(e) => setCheckpointOrder(parseInt(e.target.value) || 1)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={checkpointDescription}
                  onChange={(e) => setCheckpointDescription(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Clue Text</label>
                <textarea
                  value={checkpointClue}
                  onChange={(e) => setCheckpointClue(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={3}
                  required
                  placeholder="The riddle or clue that leads to the next location"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Hint Text (Optional)</label>
                <textarea
                  value={checkpointHint}
                  onChange={(e) => setCheckpointHint(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                  placeholder="A helpful hint if teams get stuck"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Unlock Method</label>
                <select
                  value={checkpointUnlockMethod}
                  onChange={(e) => setCheckpointUnlockMethod(e.target.value as any)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="qr_code">QR Code</option>
                  <option value="gps">GPS Location</option>
                  <option value="manual_code">Manual Code</option>
                </select>
              </div>

              {checkpointUnlockMethod === 'qr_code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">QR Code Value</label>
                  <input
                    type="text"
                    value={checkpointQRCode}
                    onChange={(e) => setCheckpointQRCode(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    required
                    placeholder="The value that the QR code should contain"
                  />
                </div>
              )}

              {checkpointUnlockMethod === 'manual_code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Manual Code</label>
                  <input
                    type="text"
                    value={checkpointManualCode}
                    onChange={(e) => setCheckpointManualCode(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    required
                    placeholder="The code players need to enter"
                  />
                </div>
              )}

              {checkpointUnlockMethod === 'gps' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={checkpointLat}
                      onChange={(e) => setCheckpointLat(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      required
                      placeholder="19.2433"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={checkpointLng}
                      onChange={(e) => setCheckpointLng(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      required
                      placeholder="73.1356"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Radius (meters)</label>
                    <input
                      type="number"
                      value={checkpointRadius}
                      onChange={(e) => setCheckpointRadius(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      required
                      placeholder="50"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                Create Checkpoint
              </button>
            </form>
          </div>
        )}

        {/* List Checkpoints */}
        {selectedHunt && checkpoints.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Checkpoints ({checkpoints.length})</h2>
            <div className="space-y-2">
              {checkpoints.map((cp) => (
                <div key={cp.id} className="p-4 bg-gray-50 rounded-lg">
                  <p className="font-semibold">
                    {cp.order_index}. {cp.title}
                  </p>
                  <p className="text-sm text-gray-600">Method: {cp.unlock_method}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
