'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import PuzzleChainBuilder, { PuzzleStepConfig } from '@/components/puzzles/PuzzleChainBuilder';
import { uploadPuzzleImage } from '@/lib/puzzles/storage';
import QRCodeGenerator, { QRCodeGeneratorRef } from '@/components/admin/QRCodeGenerator';
import { uploadQRCode, deleteQRCode } from '@/lib/utils/qrStorage';

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
  clue_text?: string; // Kept for backward compatibility, not used in UI
  hint_text?: string | null; // Kept for backward compatibility, not used in UI
  hint_1?: string | null;
  hint_2?: string | null;
  hint_3?: string | null;
  unlock_method: string;
  qr_code_value: string | null;
  qr_code_image_url?: string | null;
  is_dud_qr?: boolean;
  dud_message?: string | null;
  manual_code: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  use_puzzle_chain?: boolean;
  points?: number;
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
  
  // Checkpoint form states
  const [checkpointTitle, setCheckpointTitle] = useState('');
  const [checkpointDescription, setCheckpointDescription] = useState('');
  const [checkpointOrder, setCheckpointOrder] = useState(1);
  const [checkpointHint1, setCheckpointHint1] = useState('');
  const [checkpointHint2, setCheckpointHint2] = useState('');
  const [checkpointHint3, setCheckpointHint3] = useState('');
  const [checkpointUnlockMethod, setCheckpointUnlockMethod] = useState<'qr_code' | 'gps' | 'manual_code'>('manual_code');
  const [checkpointQRCode, setCheckpointQRCode] = useState('');
  const [checkpointQRCodeImageUrl, setCheckpointQRCodeImageUrl] = useState<string | null>(null);
  const [checkpointIsDudQr, setCheckpointIsDudQr] = useState(false);
  const [checkpointDudMessage, setCheckpointDudMessage] = useState('Try again! This is not the right QR code.');
  const [checkpointManualCode, setCheckpointManualCode] = useState('');
  const [checkpointLat, setCheckpointLat] = useState('');
  const [checkpointLng, setCheckpointLng] = useState('');
  const [checkpointRadius, setCheckpointRadius] = useState('50');
  const [checkpointPoints, setCheckpointPoints] = useState('20');
  const [usePuzzleChain, setUsePuzzleChain] = useState(false);
  const [puzzleSteps, setPuzzleSteps] = useState<PuzzleStepConfig[]>([]);
  const qrCodeGeneratorRef = useRef<QRCodeGeneratorRef>(null);

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
        supabase.from('hunts').select('*', { count: 'exact' }).order('created_at', { ascending: false }),
        supabase.from('teams').select('*', { count: 'exact' }).order('created_at', { ascending: false }),
        supabase.from('checkpoints').select('*', { count: 'exact', head: true }),
        supabase.from('progress').select('*', { count: 'exact', head: true }),
      ]);

      setHunts(huntsRes.data || []);
      setTeams(teamsRes.data || []);

      setStats({
        totalHunts: huntsRes.count || huntsRes.data?.length || 0,
        liveHunts: huntsRes.data?.filter(h => h.status === 'live').length || 0,
        totalTeams: teamsRes.count || teamsRes.data?.length || 0,
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

  const handleCreateCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHunt) {
      alert('Please select a hunt first');
      return;
    }
    if (usePuzzleChain && puzzleSteps.length === 0) {
      alert('Please add at least one puzzle step');
      return;
    }
    setIsLoading(true);
    try {
      const checkpointData: any = {
        hunt_id: selectedHunt,
        title: checkpointTitle,
        description: checkpointDescription || null,
        order_index: checkpointOrder,
        hint_1: checkpointHint1 || null,
        hint_2: checkpointHint2 || null,
        hint_3: checkpointHint3 || null,
        unlock_method: checkpointUnlockMethod,
        use_puzzle_chain: usePuzzleChain,
        points: parseInt(checkpointPoints) || 20,
      };
      if (checkpointUnlockMethod === 'qr_code') {
        checkpointData.qr_code_value = checkpointQRCode;
        checkpointData.is_dud_qr = checkpointIsDudQr;
        checkpointData.dud_message = checkpointIsDudQr ? checkpointDudMessage : null;
      } else if (checkpointUnlockMethod === 'manual_code') {
        checkpointData.manual_code = checkpointManualCode;
      } else if (checkpointUnlockMethod === 'gps') {
        checkpointData.lat = parseFloat(checkpointLat);
        checkpointData.lng = parseFloat(checkpointLng);
        checkpointData.radius_m = parseInt(checkpointRadius) || 50;
      }
      const { data: checkpoint, error } = await supabase.from('checkpoints').insert(checkpointData).select().single();
      if (error) throw error;

      // Generate and upload QR code image if QR code unlock method
      if (checkpointUnlockMethod === 'qr_code' && checkpoint && checkpointQRCode && qrCodeGeneratorRef.current) {
        try {
          // Generate QR code image data URL from the component
          const qrCodeDataUrl = await qrCodeGeneratorRef.current.generateImage();
          // Upload to storage
          const qrImageUrl = await uploadQRCode(qrCodeDataUrl, checkpoint.id);
          // Update checkpoint with image URL
          await supabase
            .from('checkpoints')
            .update({ qr_code_image_url: qrImageUrl })
            .eq('id', checkpoint.id);
          setCheckpointQRCodeImageUrl(qrImageUrl);
        } catch (qrError: any) {
          console.error('Error generating/uploading QR code:', qrError);
          // Don't fail checkpoint creation if QR upload fails
        }
      }

      // Save puzzle steps if using puzzle chain
      if (usePuzzleChain && checkpoint) {
        for (const step of puzzleSteps) {
          let imageUrl = step.puzzle_image_url;
          
          // Upload image if there's a file
          if (step.imageFile) {
            imageUrl = await uploadPuzzleImage(step.imageFile, checkpoint.id, step.id);
          }

          const stepData: any = {
            checkpoint_id: checkpoint.id,
            step_order: step.step_order,
            puzzle_type: step.puzzle_type,
            puzzle_config: step.puzzle_config,
            puzzle_image_url: imageUrl,
            answer_type: step.answer_type,
            answer_value: step.answer_value,
            title: step.title || null,
            description: step.description || null,
          };

          const { error: stepError } = await supabase.from('puzzle_steps').insert(stepData);
          if (stepError) throw stepError;
        }
      }

      alert('Checkpoint created!');
      setCheckpointTitle('');
      setCheckpointDescription('');
      setCheckpointOrder(checkpointOrder + 1);
      setCheckpointHint1('');
      setCheckpointHint2('');
      setCheckpointHint3('');
      setCheckpointQRCode('');
      setCheckpointQRCodeImageUrl(null);
      setCheckpointIsDudQr(false);
      setCheckpointDudMessage('Try again! This is not the right QR code.');
      setCheckpointManualCode('');
      setCheckpointLat('');
      setCheckpointLng('');
      setCheckpointRadius('50');
      setCheckpointPoints('20');
      setUsePuzzleChain(false);
      setPuzzleSteps([]);
      loadCheckpoints();
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to create checkpoint');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCheckpoint || !selectedHunt) return;
    if (usePuzzleChain && puzzleSteps.length === 0) {
      alert('Please add at least one puzzle step');
      return;
    }
    setIsLoading(true);
    try {
      const checkpointData: any = {
        title: checkpointTitle,
        description: checkpointDescription || null,
        order_index: checkpointOrder,
        hint_1: checkpointHint1 || null,
        hint_2: checkpointHint2 || null,
        hint_3: checkpointHint3 || null,
        unlock_method: checkpointUnlockMethod,
        use_puzzle_chain: usePuzzleChain,
        points: parseInt(checkpointPoints) || 20,
      };
      if (checkpointUnlockMethod === 'qr_code') {
        checkpointData.qr_code_value = checkpointQRCode;
        checkpointData.is_dud_qr = checkpointIsDudQr;
        checkpointData.dud_message = checkpointIsDudQr ? checkpointDudMessage : null;
        checkpointData.manual_code = null;
        checkpointData.lat = null;
        checkpointData.lng = null;
        checkpointData.radius_m = null;
      } else if (checkpointUnlockMethod === 'manual_code') {
        checkpointData.manual_code = checkpointManualCode;
        checkpointData.qr_code_value = null;
        checkpointData.lat = null;
        checkpointData.lng = null;
        checkpointData.radius_m = null;
      } else if (checkpointUnlockMethod === 'gps') {
        checkpointData.lat = parseFloat(checkpointLat);
        checkpointData.lng = parseFloat(checkpointLng);
        checkpointData.radius_m = parseInt(checkpointRadius) || 50;
        checkpointData.qr_code_value = null;
        checkpointData.manual_code = null;
      }
      const { error } = await supabase
        .from('checkpoints')
        .update(checkpointData)
        .eq('id', editingCheckpoint.id);
      if (error) throw error;

      // Generate and upload QR code image if QR code unlock method
      if (checkpointUnlockMethod === 'qr_code' && checkpointQRCode && qrCodeGeneratorRef.current) {
        try {
          // Generate QR code image data URL from the component
          const qrCodeDataUrl = await qrCodeGeneratorRef.current.generateImage();
          // Upload to storage
          const qrImageUrl = await uploadQRCode(qrCodeDataUrl, editingCheckpoint.id);
          // Update checkpoint with image URL
          await supabase
            .from('checkpoints')
            .update({ qr_code_image_url: qrImageUrl })
            .eq('id', editingCheckpoint.id);
          setCheckpointQRCodeImageUrl(qrImageUrl);
        } catch (qrError: any) {
          console.error('Error generating/uploading QR code:', qrError);
          // Don't fail checkpoint update if QR upload fails
        }
      }

      // Delete existing puzzle steps
      await supabase.from('puzzle_steps').delete().eq('checkpoint_id', editingCheckpoint.id);

      // Save new puzzle steps if using puzzle chain
      if (usePuzzleChain) {
        for (const step of puzzleSteps) {
          let imageUrl = step.puzzle_image_url;
          
          // Upload image if there's a new file
          if (step.imageFile) {
            imageUrl = await uploadPuzzleImage(step.imageFile, editingCheckpoint.id, step.id);
          }

          const stepData: any = {
            checkpoint_id: editingCheckpoint.id,
            step_order: step.step_order,
            puzzle_type: step.puzzle_type,
            puzzle_config: step.puzzle_config,
            puzzle_image_url: imageUrl,
            answer_type: step.answer_type,
            answer_value: step.answer_value,
            title: step.title || null,
            description: step.description || null,
          };

          const { error: stepError } = await supabase.from('puzzle_steps').insert(stepData);
          if (stepError) throw stepError;
        }
      }

      alert('Checkpoint updated!');
      setEditingCheckpoint(null);
      setCheckpointTitle('');
      setCheckpointDescription('');
      setCheckpointOrder(1);
      setCheckpointPoints('20');
      setCheckpointHint1('');
      setCheckpointHint2('');
      setCheckpointHint3('');
      setCheckpointQRCode('');
      setCheckpointQRCodeImageUrl(null);
      setCheckpointIsDudQr(false);
      setCheckpointDudMessage('Try again! This is not the right QR code.');
      setCheckpointManualCode('');
      setCheckpointLat('');
      setCheckpointLng('');
      setCheckpointRadius('50');
      setUsePuzzleChain(false);
      setPuzzleSteps([]);
      loadCheckpoints();
      loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Failed to update checkpoint');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditCheckpoint = async (checkpoint: Checkpoint) => {
    setEditingCheckpoint(checkpoint);
    setCheckpointTitle(checkpoint.title);
    setCheckpointDescription(checkpoint.description || '');
    setCheckpointOrder(checkpoint.order_index);
    setCheckpointHint1(checkpoint.hint_1 || '');
    setCheckpointHint2(checkpoint.hint_2 || '');
    setCheckpointHint3(checkpoint.hint_3 || '');
    setCheckpointUnlockMethod(checkpoint.unlock_method as 'qr_code' | 'gps' | 'manual_code');
    setCheckpointQRCode(checkpoint.qr_code_value || '');
    setCheckpointQRCodeImageUrl(checkpoint.qr_code_image_url || null);
    setCheckpointIsDudQr(checkpoint.is_dud_qr || false);
    setCheckpointDudMessage(checkpoint.dud_message || 'Try again! This is not the right QR code.');
    setCheckpointManualCode(checkpoint.manual_code || '');
    setCheckpointLat(checkpoint.lat?.toString() || '');
    setCheckpointLng(checkpoint.lng?.toString() || '');
    setCheckpointRadius(checkpoint.radius_m?.toString() || '50');
    setCheckpointPoints(checkpoint.points?.toString() || '20');
    setUsePuzzleChain(checkpoint.use_puzzle_chain || false);

    // Load puzzle steps if using puzzle chain
    if (checkpoint.use_puzzle_chain) {
      const { data: steps, error } = await supabase
        .from('puzzle_steps')
        .select('*')
        .eq('checkpoint_id', checkpoint.id)
        .order('step_order', { ascending: true });

      if (!error && steps) {
        const stepConfigs: PuzzleStepConfig[] = steps.map((step: any) => ({
          id: step.id,
          step_order: step.step_order,
          puzzle_type: step.puzzle_type,
          puzzle_config: step.puzzle_config || {},
          puzzle_image_url: step.puzzle_image_url,
          answer_type: step.answer_type,
          answer_value: step.answer_value || '',
          title: step.title || '',
          description: step.description || '',
        }));
        setPuzzleSteps(stepConfigs);
      }
    } else {
      setPuzzleSteps([]);
    }
  };

  const handleDeleteCheckpoint = async (id: string) => {
    if (!confirm('Are you sure? This will delete this checkpoint and all progress!')) return;
    try {
      // Delete QR code image from storage
      await deleteQRCode(id);
      
      // Delete checkpoint (cascade will handle related data)
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
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
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
              <p className="text-sm text-gray-600 mt-1">Manage hunts, checkpoints, and teams</p>
            </div>
            <div className="flex gap-3 items-center">
              <Link
                href="/"
                className="text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                ← Back to Home
              </Link>
              <button
                onClick={() => setIsAuthenticated(false)}
                className="text-red-600 hover:text-red-700 font-semibold"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 md:gap-2 mt-4 border-b overflow-x-auto">
            {(['dashboard', 'hunts', 'checkpoints', 'teams'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 md:px-4 py-2 font-semibold capitalize transition-colors whitespace-nowrap text-sm md:text-base ${
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
                <p className="text-xs md:text-sm text-gray-800 font-medium">Total Hunts</p>
                <p className="text-2xl md:text-3xl font-bold text-gray-900">{stats.totalHunts}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
                <p className="text-xs md:text-sm text-gray-800 font-medium">Live Hunts</p>
                <p className="text-2xl md:text-3xl font-bold text-green-600">{stats.liveHunts}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
                <p className="text-xs md:text-sm text-gray-800 font-medium">Total Teams</p>
                <p className="text-2xl md:text-3xl font-bold text-blue-600">{stats.totalTeams}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
                <p className="text-xs md:text-sm text-gray-800 font-medium">Checkpoints</p>
                <p className="text-2xl md:text-3xl font-bold text-purple-600">{stats.totalCheckpoints}</p>
              </div>
              <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 col-span-2 md:col-span-1">
                <p className="text-xs md:text-sm text-gray-800 font-medium">Progress</p>
                <p className="text-2xl md:text-3xl font-bold text-orange-600">{stats.totalProgress}</p>
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
            <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">
                {editingHunt ? 'Edit Hunt' : 'Create New Hunt'}
              </h2>
              <form onSubmit={editingHunt ? handleEditHunt : handleCreateHunt} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Hunt Name</label>
                  <input
                    type="text"
                    value={huntName}
                    onChange={(e) => setHuntName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <textarea
                    value={huntDescription}
                    onChange={(e) => setHuntDescription(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={huntStatus}
                    onChange={(e) => setHuntStatus(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
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
            <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">All Hunts</h2>
              <div className="space-y-3">
                {hunts.map((hunt) => (
                  <div key={hunt.id} className="p-4 bg-gray-50 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-base md:text-lg">{hunt.name}</p>
                      <p className="text-xs md:text-sm text-gray-600">
                        Status: <span className={`font-semibold ${
                          hunt.status === 'live' ? 'text-green-600' :
                          hunt.status === 'completed' ? 'text-gray-600' : 'text-yellow-600'
                        }`}>{hunt.status}</span>
                      </p>
                      {hunt.description && (
                        <p className="text-xs md:text-sm text-gray-500 mt-1">{hunt.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditHunt(hunt)}
                        className="flex-1 sm:flex-none bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteHunt(hunt.id)}
                        className="flex-1 sm:flex-none bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600"
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
            <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Select Hunt</h2>
              <select
                value={selectedHunt || ''}
                onChange={(e) => {
                  setSelectedHunt(e.target.value || null);
                  setEditingCheckpoint(null); // Reset edit mode when changing hunt
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
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
              <>
                {/* Create/Edit Checkpoint Form */}
                <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">
                    {editingCheckpoint ? 'Edit Checkpoint' : 'Create Checkpoint'}
                  </h2>
                  <form onSubmit={editingCheckpoint ? handleEditCheckpoint : handleCreateCheckpoint} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                        <input
                          type="text"
                          value={checkpointTitle}
                          onChange={(e) => setCheckpointTitle(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                          required
                        />
                      </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Order Index</label>
                      <input
                        type="number"
                        value={checkpointOrder}
                        onChange={(e) => setCheckpointOrder(parseInt(e.target.value) || 1)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Points (default: 20)</label>
                      <input
                        type="number"
                        min="1"
                        value={checkpointPoints}
                        onChange={(e) => setCheckpointPoints(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                      <textarea
                        value={checkpointDescription}
                        onChange={(e) => setCheckpointDescription(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                        rows={2}
                      />
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Hint 1 (Costs 5 points)
                        </label>
                        <textarea
                          value={checkpointHint1}
                          onChange={(e) => setCheckpointHint1(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                          rows={2}
                          placeholder="First hint for this checkpoint"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Hint 2 (Costs 5 points)
                        </label>
                        <textarea
                          value={checkpointHint2}
                          onChange={(e) => setCheckpointHint2(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                          rows={2}
                          placeholder="Second hint for this checkpoint"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Hint 3 (Costs 5 points)
                        </label>
                        <textarea
                          value={checkpointHint3}
                          onChange={(e) => setCheckpointHint3(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                          rows={2}
                          placeholder="Third hint for this checkpoint"
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        Each hint costs 5 points. Teams can use up to 3 hints per checkpoint.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <input
                        type="checkbox"
                        id="usePuzzleChain"
                        checked={usePuzzleChain}
                        onChange={(e) => {
                          setUsePuzzleChain(e.target.checked);
                          if (!e.target.checked) {
                            setPuzzleSteps([]);
                          }
                        }}
                        className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                      />
                      <label htmlFor="usePuzzleChain" className="text-sm font-medium text-gray-700 cursor-pointer">
                        Use Puzzle Chain (instead of simple question)
                      </label>
                    </div>
                    {usePuzzleChain && (
                      <div className="p-4 bg-gray-50 border border-gray-300 rounded-lg">
                        <PuzzleChainBuilder
                          steps={puzzleSteps}
                          onChange={setPuzzleSteps}
                          checkpointId={editingCheckpoint?.id}
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Unlock Method</label>
                      <select
                        value={checkpointUnlockMethod}
                        onChange={(e) => setCheckpointUnlockMethod(e.target.value as any)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                      >
                        <option value="qr_code">QR Code</option>
                        <option value="gps">GPS Location</option>
                        <option value="manual_code">Manual Code</option>
                      </select>
                    </div>
                    {checkpointUnlockMethod === 'qr_code' && (
                      <div>
                        <QRCodeGenerator
                          ref={qrCodeGeneratorRef}
                          checkpointId={editingCheckpoint?.id}
                          qrCodeValue={checkpointQRCode}
                          qrCodeImageUrl={checkpointQRCodeImageUrl}
                          isDudQr={checkpointIsDudQr}
                          dudMessage={checkpointDudMessage}
                          onValueChange={setCheckpointQRCode}
                          onImageUrlChange={setCheckpointQRCodeImageUrl}
                          onDudChange={setCheckpointIsDudQr}
                          onDudMessageChange={setCheckpointDudMessage}
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
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
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
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
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
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
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
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
                            required
                            placeholder="50"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="flex-1 md:flex-none bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 text-base"
                      >
                        {isLoading ? (editingCheckpoint ? 'Updating...' : 'Creating...') : (editingCheckpoint ? 'Update Checkpoint' : 'Create Checkpoint')}
                      </button>
                      {editingCheckpoint && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCheckpoint(null);
                            setCheckpointTitle('');
                            setCheckpointDescription('');
                            setCheckpointOrder(1);
                            setCheckpointHint1('');
                            setCheckpointHint2('');
                            setCheckpointHint3('');
                            setCheckpointQRCode('');
                            setCheckpointManualCode('');
                            setCheckpointLat('');
                            setCheckpointLng('');
                            setCheckpointRadius('50');
                            setUsePuzzleChain(false);
                            setPuzzleSteps([]);
                          }}
                          className="flex-1 md:flex-none bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 text-base"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                </div>

                {/* List Checkpoints */}
                <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Checkpoints ({checkpoints.length})</h2>
                  <div className="space-y-3">
                    {checkpoints.map((cp) => (
                      <div key={cp.id} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex-1">
                            <p className="font-semibold text-base">
                              {cp.order_index}. {cp.title}
                            </p>
                            <p className="text-sm text-gray-600">Method: {cp.unlock_method}</p>
                            {cp.description && (
                              <p className="text-sm text-gray-500 mt-1">{cp.description}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditCheckpoint(cp)}
                              className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600 w-full sm:w-auto"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteCheckpoint(cp.id)}
                              className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 w-full sm:w-auto"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {checkpoints.length === 0 && (
                      <p className="text-gray-500 text-center py-4">No checkpoints yet. Create one above!</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Teams Tab */}
        {activeTab === 'teams' && (
          <div className="space-y-6">
            {editingTeam && (
              <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Edit Team</h2>
                <form onSubmit={handleEditTeam} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Team Name</label>
                    <input
                      type="text"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
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

            <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">All Teams ({teams.length})</h2>
              <div className="space-y-3">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} onEdit={startEditTeam} onDelete={handleDeleteTeam} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Team Card component with members
function TeamCard({ team, onEdit, onDelete }: { team: Team; onEdit: (team: Team) => void; onDelete: (id: string) => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMembers();
  }, [team.id]);

  const loadMembers = async () => {
    try {
      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('team_id', team.id)
        .order('order_index', { ascending: true });
      setMembers(data || []);
    } catch (err) {
      console.error('Error loading members:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold text-base md:text-lg text-gray-900">{team.name}</p>
          <p className="text-xs md:text-sm text-gray-700">
            Joined: {new Date(team.created_at).toLocaleString()}
          </p>
          {!loading && members.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-800 mb-1">Members ({members.length}):</p>
              <div className="flex flex-wrap gap-1">
                {members.map((member, idx) => (
                  <span key={member.id} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                    {member.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(team)}
            className="flex-1 sm:flex-none bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(team.id)}
            className="flex-1 sm:flex-none bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600"
          >
            Delete
          </button>
        </div>
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
      const { data: checkpoints, error: checkpointsError } = await supabase
        .from('checkpoints')
        .select('id')
        .eq('hunt_id', hunt.id);
      
      if (checkpointsError) {
        console.error('Error loading checkpoints:', checkpointsError);
      }
      
      setTotalCheckpoints(checkpoints?.length || 0);
      const checkpointIds = checkpoints?.map(cp => cp.id) || [];

      if (checkpointIds.length === 0) {
        setLeaderboard([]);
        return;
      }

      const { data: teams, error: teamsError } = await supabase.from('teams').select('id, name');
      
      if (teamsError) {
        console.error('Error loading teams:', teamsError);
      }

      const { data: progress, error: progressError } = await supabase
        .from('progress')
        .select('team_id, checkpoint_id')
        .in('checkpoint_id', checkpointIds);

      if (progressError) {
        console.error('Error loading progress:', progressError);
      }

      // Get unique team IDs that have progress
      const teamIdsWithProgress = new Set(progress?.map(p => p.team_id) || []);

      const teamProgress: Record<string, any> = {};
      teams?.forEach((team) => {
        // Only show teams that have started (have progress)
        if (teamIdsWithProgress.has(team.id)) {
          const completed = progress?.filter(p => p.team_id === team.id).length || 0;
          teamProgress[team.id] = {
            team_id: team.id,
            team_name: team.name,
            checkpoints_completed: completed,
          };
        }
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
                <span className="font-semibold text-gray-900">{entry.team_name}</span>
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
