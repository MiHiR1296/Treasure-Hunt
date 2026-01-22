'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface Team {
  id: string;
  name: string;
}

interface TeamContextType {
  team: Team | null;
  setTeam: (team: Team | null) => void;
  isLoading: boolean;
}

const TeamContext = createContext<TeamContextType | undefined>(undefined);

export function TeamProvider({ children }: { children: ReactNode }) {
  const [team, setTeamState] = useState<Team | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load team from localStorage on mount
    const stored = localStorage.getItem('treasure_hunt_team');
    if (stored) {
      try {
        setTeamState(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored team:', e);
      }
    }
    setIsLoading(false);
  }, []);

  const setTeam = (newTeam: Team | null) => {
    setTeamState(newTeam);
    if (newTeam) {
      localStorage.setItem('treasure_hunt_team', JSON.stringify(newTeam));
    } else {
      localStorage.removeItem('treasure_hunt_team');
    }
  };

  return (
    <TeamContext.Provider value={{ team, setTeam, isLoading }}>
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
