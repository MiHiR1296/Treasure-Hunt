import { TeamProvider } from '@/lib/context/TeamContext';

export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return <TeamProvider>{children}</TeamProvider>;
}
