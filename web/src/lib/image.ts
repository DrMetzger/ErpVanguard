// Reduz uma imagem no navegador e devolve JPEG em base64 (fundo branco para PNG transparente).
export function resizeImage(file: File | Blob, maxSide: number, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir esta imagem')) }
    img.src = url
  })
}

// Foto (até 1600 px) + miniatura quadrada para listas (até 160 px).
export async function photoPair(file: File) {
  return { image: await resizeImage(file, 1600, 0.85), thumb: await resizeImage(file, 160, 0.8) }
}
