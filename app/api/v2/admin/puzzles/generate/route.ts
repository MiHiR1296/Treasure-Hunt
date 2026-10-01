import { NextRequest } from 'next/server'
import { generatePuzzles, parsePuzzleGenerationInput } from '@/lib/engine/puzzles/generator'
import { handle, jsonBody, requireSession } from '@/lib/server/http'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Organizer-only factory endpoint. Its answer keys are previews, never saved into a hunt definition. */
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin')
    const input = parsePuzzleGenerationInput(await jsonBody(request))
    return { generated: generatePuzzles(input) }
  })
}
