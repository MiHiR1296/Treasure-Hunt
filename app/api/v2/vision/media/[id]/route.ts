import { NextRequest, NextResponse } from 'next/server'
import { handle } from '@/lib/server/http'
import { authorizeVisionMediaRecord, readVisionMedia } from '@/lib/server/media'
import { createMediaReadUrl, mediaBackend } from '@/lib/server/media-storage.mjs'
import { authorizeVisionMedia, requireVisionWorker } from '@/lib/server/vision-jobs'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireVisionWorker(request.headers.get('authorization'))
    const mediaId = (await context.params).id
    await authorizeVisionMedia(request.headers.get('x-vision-job') || '',mediaId,request.headers.get('x-vision-lease') || '')
    if (mediaBackend() === 'supabase') {
      const media = await authorizeVisionMediaRecord(mediaId)
      const response = NextResponse.redirect(await createMediaReadUrl(media.storage_key,120),307)
      response.headers.set('Referrer-Policy','no-referrer')
      return response
    }
    const { media,bytes } = await readVisionMedia(mediaId)
    return new NextResponse(new Uint8Array(bytes),{ headers:{ 'Content-Type':media.content_type,'Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'" } })
  })
}
