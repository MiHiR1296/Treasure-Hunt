import type { Metadata } from 'next';
import OrganizerConsole from '@/components/v2/OrganizerConsole';

export const metadata: Metadata = {
  title: 'Organizer · Treasure Hunt V2',
  description: 'Create and run configurable treasure hunts.',
};

export default function OrganizerPage() {
  return <OrganizerConsole />;
}
