// Helper function to generate QR code image data URL from SVG element
// This function takes an SVG element (from QRCodeSVG) and converts it to a data URL

export async function generateQRCodeImageDataUrlFromSVG(
  svgElement: SVGSVGElement,
  size: number = 256
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Serialize SVG to string
      const svgData = new XMLSerializer().serializeToString(svgElement);
      
      // Create image from SVG
      const img = new Image();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      img.onload = () => {
        // Draw image on canvas
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(img.src);
        resolve(dataUrl);
      };

      img.onerror = () => {
        reject(new Error('Failed to load SVG image'));
      };

      // Create blob URL from SVG
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.src = url;
    } catch (error: any) {
      reject(error);
    }
  });
}

// Alternative: Generate QR code using qrcode library (canvas-based)
// This is a simpler approach that doesn't require React rendering
export async function generateQRCodeImageDataUrl(
  qrCodeValue: string,
  size: number = 256
): Promise<string> {
  // For now, return a placeholder
  // The actual implementation should use the QRCodeGenerator component
  // which will call generateQRCodeImageDataUrlFromSVG with the rendered SVG
  throw new Error('Use QRCodeGenerator component to generate QR code images');
}
