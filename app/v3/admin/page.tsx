import type { Metadata } from 'next';
import OrganizerConsole from '@/components/v3/admin/OrganizerConsole';

export const metadata: Metadata = {
  title: 'Organizer · Treasure Hunt V3',
  description: 'Run live events, inspect replay-aware analytics, and author validated Treasure Hunt V3 experiences.',
};

export default function V3OrganizerPage() {
  return <OrganizerConsole />;
}
