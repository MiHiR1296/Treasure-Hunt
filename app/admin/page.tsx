'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

const ADMIN_PASSWORD = typeof window !== 'undefined' 
  ? (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'admin123')
  : 'admin123';

type Tab = 'dashboard' | 'hunts' | 'checkpoints' | 'teams';

interface Hunt {
  id: string;
  name: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

interface Checkpoint {
  id: string;
  hunt_id: string;
  title: string;
  description: string | null;
  order_index: number;
  clue_text: string;
  hint_text: string | null;
  unlock_method: string;
  qr_code_value: string | null;
  manual_code: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
}

interface Team {
  id: string;
  name: string;
  created_at: string;
}

interface DashboardStats {
  totalHunts: number;
  liveHunts: number;
  totalTeams: number;
  totalCheckpoints: number;
  totalProgress: number;
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isLoading, setIsLoading] = useState(false);

  // Data states
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalHunts: 0,
    liveHunts: 0,
    totalTeams: 0,
    totalCheckpoints: 0,
    totalProgress: 0,
  });

  // Selected items
  const [selectedHunt, setSelectedHunt] = useState<string | null>(null);
  const [editingHunt, setEditingHunt] = useState<Hunt | null>(null);
  const [editingCheckpoint, setEditingCheckpoint] = useState<Checkpoint | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  // Form states
  const [huntName, setHuntName] = useState('');
  const [huntDescription, setHuntDescription] = useState('');
  const [huntStatus, setHuntStatus] = useState('draft');
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      loadDashboard();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (selectedHunt && activeTab === 'checkpoints') {
      loadCheckpoints();
    }
  }, [selectedHunt, activeTab]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert('Incorrect password');
    }
  };

  const loadDashboard = async () => {
    try {
      // Load all data
      const [huntsRes, teamsRes, checkpointsRes, progressRes] = await Promise.all([
        supabase.from('hunts').select('*').order('created_at', { ascending: false }),
        supabase.from('teams').select('*').order('created_at', { ascending: false }),
        supabase.from('checkpoints').select('id', { count: 'exact', head: true }),
        supabase.from('progress').select('id', { count: 'exact', head: true }),
      ]);

      setHunts(huntsRes.data || []);
      setTeams(teamsRes.data || []);

      setStats({
        totalHunts: huntsRes.data?.length || 0,
        liveHunts: huntsRes.data?.filter(h => h.status === 'live').length || 0,
        totalTeams: teamsRes.data?.length || 0,
        totalCheckpoints: checkpointsRes.count || 0,
        totalProgress: progressRes.count || 0,
      });
    } catch (err) {
      console.error('Error loading dashboard:', err);
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
      const { error } = await supabase.from('hunts').insert({
        name: huntName,
        description: huntDescription || null,
        status: huntStatus,
      });
      if (error) throw error;
      alert('Hunt created!');
      setHuntName('');
      setHuntDescription('');
      setHuntStatus('draft');
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to create hunt');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditHunt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHunt) return;
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('hunts')
        .update({
          name: huntName,
          description: huntDescription || null,
          status: huntStatus,
        })
        .eq('id', editingHunt.id);
      if (error) throw error;
      alert('Hunt updated!');
      setEditingHunt(null);
      setHuntName('');
      setHuntDescription('');
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to update hunt');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteHunt = async (id: string) => {
    if (!confirm('Are you sure? This will delete all checkpoints and progress for this hunt!')) return;
    try {
      const { error } = await supabase.from('hunts').delete().eq('id', id);
      if (error) throw error;
      alert('Hunt deleted!');
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to delete hunt');
    }
  };

  const handleDeleteCheckpoint = async (id: string) => {
    if (!confirm('Are you sure? This will delete this checkpoint and all progress!')) return;
    try {
      const { error } = await supabase.from('checkpoints').delete().eq('id', id);
      if (error) throw error;
      alert('Checkpoint deleted!');
      loadCheckpoints();
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to delete checkpoint');
    }
  };

  const handleEditTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('teams')
        .update({ name: teamName })
        .eq('id', editingTeam.id);
      if (error) throw error;
      alert('Team updated!');
      setEditingTeam(null);
      setTeamName('');
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to update team');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    if (!confirm('Are you sure? This will delete the team and all their progress!')) return;
    try {
      const { error } = await supabase.from('teams').delete().eq('id', id);
      if (error) throw error;
      alert('Team deleted!');
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to delete team');
    }
  };

  const startEditHunt = (hunt: Hunt) => {
    setEditingHunt(hunt);
    setHuntName(hunt.name);
    setHuntDescription(hunt.description || '');
    setHuntStatus(hunt.status);
  };

  const startEditTeam = (team: Team) => {
    setEditingTeam(team);
    setTeamName(team.name);
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
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
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
            <button
              onClick={() => setIsAuthenticated(false)}
              className="text-red-600 hover:text-red-700 font-semibold"
            >
              Logout
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4 border-b">
            {(['dashboard', 'hunts', 'checkpoints', 'teams'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-semibold capitalize transition-colors ${
                  activeTab === tab
                    ? 'border-b-2 border-indigo-600 text-indigo-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <p className="text-sm text-gray-600">Total Hunts</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalHunts}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <p className="text-sm text-gray-600">Live Hunts</p>
                <p className="text-3xl font-bold text-green-600">{stats.liveHunts}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <p className="text-sm text-gray-600">Total Teams</p>
                <p className="text-3xl font-bold text-blue-600">{stats.totalTeams}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <p className="text-sm text-gray-600">Checkpoints</p>
                <p className="text-3xl font-bold text-purple-600">{stats.totalCheckpoints}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-6">
                <p className="text-sm text-gray-600">Progress Entries</p>
                <p className="text-3xl font-bold text-orange-600">{stats.totalProgress}</p>
              </div>
            </div>

            {/* Live Hunts Leaderboards */}
            {hunts.filter(h => h.status === 'live').map((hunt) => (
              <HuntLeaderboard key={hunt.id} hunt={hunt} />
            ))}
          </div>
        )}

        {/* Hunts Tab */}
        {activeTab === 'hunts' && (
          <div className="space-y-6">
            {/* Create/Edit Hunt Form */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {editingHunt ? 'Edit Hunt' : 'Create New Hunt'}
              </h2>
              <form onSubmit={editingHunt ? handleEditHunt : handleCreateHunt} className="space-y-4">
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
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {editingHunt ? 'Update Hunt' : 'Create Hunt'}
                  </button>
                  {editingHunt && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHunt(null);
                        setHuntName('');
                        setHuntDescription('');
                        setHuntStatus('draft');
                      }}
                      className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-semibold hover:bg-gray-400"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Hunts List */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">All Hunts</h2>
              <div className="space-y-3">
                {hunts.map((hunt) => (
                  <div key={hunt.id} className="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-lg">{hunt.name}</p>
                      <p className="text-sm text-gray-600">
                        Status: <span className={`font-semibold ${
                          hunt.status === 'live' ? 'text-green-600' :
                          hunt.status === 'completed' ? 'text-gray-600' : 'text-yellow-600'
                        }`}>{hunt.status}</span>
                      </p>
                      {hunt.description && (
                        <p className="text-sm text-gray-500 mt-1">{hunt.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditHunt(hunt)}
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteHunt(hunt.id)}
                        className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Checkpoints Tab */}
        {activeTab === 'checkpoints' && (
          <div className="space-y-6">
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

            {selectedHunt && (
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Checkpoints</h2>
                <div className="space-y-3">
                  {checkpoints.map((cp) => (
                    <div key={cp.id} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">
                            {cp.order_index}. {cp.title}
                          </p>
                          <p className="text-sm text-gray-600">Method: {cp.unlock_method}</p>
                          {cp.description && (
                            <p className="text-sm text-gray-500 mt-1">{cp.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteCheckpoint(cp.id)}
                          className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Teams Tab */}
        {activeTab === 'teams' && (
          <div className="space-y-6">
            {editingTeam && (
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Edit Team</h2>
                <form onSubmit={handleEditTeam} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Team Name</label>
                    <input
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Update Team
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTeam(null);
                        setTeamName('');
                      }}
                      className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-semibold hover:bg-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">All Teams ({teams.length})</h2>
              <div className="space-y-3">
                {teams.map((team) => (
                  <div key={team.id} className="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-lg">{team.name}</p>
                      <p className="text-sm text-gray-500">
                        Joined: {new Date(team.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditTeam(team)}
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTeam(team.id)}
                        className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Leaderboard component for dashboard
function HuntLeaderboard({ hunt }: { hunt: Hunt }) {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [totalCheckpoints, setTotalCheckpoints] = useState(0);

  useEffect(() => {
    loadLeaderboard();
  }, [hunt.id]);

  const loadLeaderboard = async () => {
    try {
      const { data: checkpoints } = await supabase
        .from('checkpoints')
        .select('id')
        .eq('hunt_id', hunt.id);
      
      setTotalCheckpoints(checkpoints?.length || 0);
      const checkpointIds = checkpoints?.map(cp => cp.id) || [];

      const { data: teams } = await supabase.from('teams').select('id, name');
      const { data: progress } = await supabase
        .from('progress')
        .select('team_id, checkpoint_id')
        .in('checkpoint_id', checkpointIds);

      const teamProgress: Record<string, any> = {};
      teams?.forEach((team) => {
        const completed = progress?.filter(p => p.team_id === team.id).length || 0;
        teamProgress[team.id] = {
          team_id: team.id,
          team_name: team.name,
          checkpoints_completed: completed,
        };
      });

      const sorted = Object.values(teamProgress).sort((a: any, b: any) => 
        b.checkpoints_completed - a.checkpoints_completed
      );

      setLeaderboard(sorted);
    } catch (err) {
      console.error('Error loading leaderboard:', err);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-900">{hunt.name}</h3>
        <Link
          href={`/hunt/${hunt.id}/leaderboard`}
          className="text-indigo-600 hover:text-indigo-700 font-semibold text-sm"
        >
          View Full Leaderboard →
        </Link>
      </div>
      <div className="space-y-2">
        {leaderboard.slice(0, 5).map((entry: any, index) => {
          const rank = index + 1;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
          return (
            <div key={entry.team_id} className="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{medal}</span>
                <span className="font-semibold">{entry.team_name}</span>
              </div>
              <span className="font-semibold text-gray-700">
                {entry.checkpoints_completed} / {totalCheckpoints}
              </span>
            </div>
          );
        })}
        {leaderboard.length === 0 && (
          <p className="text-gray-500 text-center py-4">No teams yet</p>
        )}
      </div>
    </div>
  );
}
