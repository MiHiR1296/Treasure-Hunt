export interface PendingPhoto {
  key: string
  requestId: string
  blob: Blob
  mediaId?: string
  location?: { latitude: number; longitude: number; accuracyMeters: number }
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hunt-v2-photos', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function photoRecord(key: string, value?: PendingPhoto | null): Promise<PendingPhoto | null> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('pending', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('pending')
      const request = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value)
      let result: PendingPhoto | null = null
      request.onsuccess = () => { result = value === undefined ? request.result ?? null : value }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.')
  const image = new Image()
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This image could not be opened. Try a JPEG or PNG photo.')); image.src = url })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the photo.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This photo could not be compressed.')), 'image/jpeg', 0.82))
  } finally { URL.revokeObjectURL(url) }
}
