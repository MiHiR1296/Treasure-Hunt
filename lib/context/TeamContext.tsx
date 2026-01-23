'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';

interface Team {
  id: string;
  name: string;
}

interface User {
  id: string;
  name: string;
  team_id: string;
}

interface TeamContextType {
  team: Team | null;
  user: User | null;
  setTeam: (team: Team | null) => void;
  setUser: (user: User | null) => void;
  isLoading: boolean;
}

const TeamContext = createContext<TeamContextType | undefined>(undefined);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [team, setTeamState] = useState<Team | null>(null);
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFromStorage();
  }, []);

  const loadFromStorage = async () => {
    try {
      // Load team from localStorage
      const storedTeam = localStorage.getItem('treasure_hunt_team');
      const storedUser = localStorage.getItem('treasure_hunt_user');

      if (storedTeam) {
        try {
          const teamData = JSON.parse(storedTeam);
          
          // Validate team exists in database
          const { data: teamExists, error } = await supabase
            .from('teams')
            .select('id, name')
            .eq('id', teamData.id)
            .single();

          if (error || !teamExists) {
            console.warn('Stored team not found in database, clearing localStorage');
            localStorage.removeItem('treasure_hunt_team');
            localStorage.removeItem('treasure_hunt_user');
          } else {
            setTeamState(teamExists);
          }
        } catch (e) {
          console.error('Failed to parse stored team:', e);
          localStorage.removeItem('treasure_hunt_team');
        }
      }

      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          
          // Validate user exists in database (if users table exists)
          const { data: userExists } = await supabase
            .from('users')
            .select('id, name, team_id')
            .eq('id', userData.id)
            .single();

          if (userExists) {
            setUserState(userExists);
          } else {
            // User table might not exist yet, or user was deleted
            // Keep user data for backward compatibility
            setUserState(userData);
          }
        } catch (e) {
          console.error('Failed to parse stored user:', e);
          // Don't clear user if table doesn't exist yet
        }
      }
    } catch (err) {
      console.error('Error loading from storage:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const setTeam = (newTeam: Team | null) => {
    setTeamState(newTeam);
    if (newTeam) {
      localStorage.setItem('treasure_hunt_team', JSON.stringify(newTeam));
    } else {
      localStorage.removeItem('treasure_hunt_team');
      // Also clear user when team is cleared
      setUserState(null);
      localStorage.removeItem('treasure_hunt_user');
    }
  };

  const setUser = (newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      localStorage.setItem('treasure_hunt_user', JSON.stringify(newUser));
    } else {
      localStorage.removeItem('treasure_hunt_user');
    }
  };

  return (
    <TeamContext.Provider value={{ team, user, setTeam, setUser, isLoading }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  const context = useContext(TeamContext);
  if (context === undefined) {
    throw new Error('useTeam must be used within a TeamProvider');
  }
  return context;
}
