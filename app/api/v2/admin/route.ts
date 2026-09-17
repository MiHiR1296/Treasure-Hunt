import { NextRequest } from 'next/server';
import { handle, requireSession } from '@/lib/server/http';
import { organizerSnapshot } from '@/lib/server/store';
import { exampleHunt } from '@/lib/engine/example';
import { huntTemplates, instantiateTemplate } from '@/lib/engine/templates';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    return { ...await organizerSnapshot(), example: exampleHunt,
      templates: huntTemplates.map(template => ({ ...template, definition: instantiateTemplate(template.id) })) };
  });
}
