import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export async function GET() {
  const prompt = await readFile(resolve(process.cwd(), 'docs/v3-authoring-kit.md'), 'utf8')
    .catch(() => 'Use the V3 JSON Schema and starter file to create a valid Treasure Hunt V3 draft.');
  return NextResponse.json({
    version: 3,
    schemaUrl: '/authoring/treasure-hunt-v3.schema.json',
    starterUrl: '/authoring/treasure-hunt-v3.starter.json',
    annotatedExampleUrl: '/authoring/treasure-hunt-v3.annotated-example.json',
    prompt,
    workflow: ['Download or copy the kit', 'Edit with Codex or another external assistant', 'Import as a draft', 'Fix path-specific validation issues', 'Preview', 'Publish explicitly'],
    warning: 'Never add production QR secrets, private route seeds, database IDs, or service credentials to an external prompt.',
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
