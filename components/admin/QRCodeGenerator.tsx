'use client';

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeGeneratorProps {
  checkpointId?: string; // For generating unique codes
  qrCodeValue: string;
  qrCodeImageUrl?: string | null;
  isDudQr: boolean;
  dudMessage: string;
  onValueChange: (value: string) => void;
  onImageUrlChange: (url: string) => void;
  onDudChange: (isDud: boolean) => void;
  onDudMessageChange: (message: string) => void;
}

export interface QRCodeGeneratorRef {
  generateImage: () => Promise<string>;
}

const QRCodeGenerator = forwardRef<QRCodeGeneratorRef, QRCodeGeneratorProps>(function QRCodeGenerator({
  checkpointId,
  qrCodeValue,
  qrCodeImageUrl,
  isDudQr,
  dudMessage,
  onValueChange,
  onImageUrlChange,
  onDudChange,
  onDudMessageChange,
}, ref) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Auto-generate QR code value if empty
  useEffect(() => {
    if (!qrCodeValue && checkpointId) {
      const generatedValue = `CHECKPOINT-${checkpointId}`;
      onValueChange(generatedValue);
    } else if (!qrCodeValue) {
      // Generate random UUID if no checkpoint ID
      const randomId = crypto.randomUUID();
      const generatedValue = `CHECKPOINT-${randomId}`;
      onValueChange(generatedValue);
    }
  }, [checkpointId, qrCodeValue, onValueChange]);

  const downloadQRCode = () => {
    if (!qrRef.current) return;

    // Get the SVG element
    const svgElement = qrRef.current.querySelector('svg');
    if (!svgElement) return;

    // Convert SVG to data URL
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `qr-code-${checkpointId || 'checkpoint'}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }, 'image/png');
      }
    };

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.src = url;
  };

  // Export function to generate QR code image data URL
  // This will be called by the parent component when saving
  const generateQRCodeImage = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!qrRef.current) {
        reject(new Error('QR code element not found'));
        return;
      }

      const svgElement = qrRef.current.querySelector('svg') as SVGSVGElement;
      if (!svgElement) {
        reject(new Error('SVG element not found'));
        return;
      }

      // Convert SVG to data URL
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        canvas.width = 256;
        canvas.height = 256;
        if (ctx) {
          ctx.drawImage(img, 0, 0, 256, 256);
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl);
        } else {
          reject(new Error('Could not get canvas context'));
        }
        URL.revokeObjectURL(img.src);
      };

      img.onerror = () => {
        reject(new Error('Failed to load SVG image'));
      };

      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.src = url;
    });
  };

  // Expose generate function via ref
  useImperativeHandle(ref, () => ({
    generateImage: generateQRCodeImage,
  }), [qrCodeValue]);


  return (
    <div className="space-y-4">
      {/* QR Code Value Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          QR Code Value (Auto-generated)
        </label>
        <input
          type="text"
          value={qrCodeValue}
          onChange={(e) => onValueChange(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white font-mono"
          placeholder="CHECKPOINT-abc123"
        />
        <p className="text-xs text-gray-500 mt-1">
          This value will be encoded in the QR code. Players must scan a QR code containing this exact value.
        </p>
      </div>

      {/* QR Code Preview */}
      {qrCodeValue && (
        <div className="bg-white border-2 border-gray-200 rounded-xl p-6 flex flex-col items-center">
          <div ref={qrRef} className="mb-4">
            <QRCodeSVG
              value={qrCodeValue}
              size={256}
              level="M"
              includeMargin={true}
            />
          </div>
          
          {/* Download Button */}
          <button
            type="button"
            onClick={downloadQRCode}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
          >
            📥 Download QR Code
          </button>
        </div>
      )}

      {/* Stored QR Code Image (if exists) */}
      {qrCodeImageUrl && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Stored QR Code Image:</p>
          <img
            src={qrCodeImageUrl}
            alt="Stored QR Code"
            className="max-w-xs mx-auto rounded-lg"
          />
        </div>
      )}

      {/* Dud QR Options */}
      <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            id="isDudQr"
            checked={isDudQr}
            onChange={(e) => onDudChange(e.target.checked)}
            className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
          />
          <label htmlFor="isDudQr" className="text-sm font-medium text-gray-700 cursor-pointer">
            Mark as Dud QR (fake/distraction QR code)
          </label>
        </div>
        {isDudQr && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dud QR Message
            </label>
            <textarea
              value={dudMessage}
              onChange={(e) => onDudMessageChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-base text-gray-900 bg-white"
              rows={2}
              placeholder="Try again! This is not the right QR code."
            />
            <p className="text-xs text-gray-500 mt-1">
              This message will be shown when players scan this QR code.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

export default QRCodeGenerator;

// Export function to generate QR code image data URL
export async function generateQRCodeImageDataUrl(
  qrCodeValue: string,
  size: number = 256
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a temporary container
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    // Import QRCodeSVG dynamically
    import('qrcode.react').then(({ QRCodeSVG }) => {
      // Create SVG element
      const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgElement.setAttribute('width', size.toString());
      svgElement.setAttribute('height', size.toString());
      container.appendChild(svgElement);

      // Render QR code (we'll use a canvas approach instead)
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        document.body.removeChild(container);
        reject(new Error('Could not get canvas context'));
        return;
      }

      // For now, use a simpler approach - create data URL from SVG string
      const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="white"/></svg>`;
      
      // Actually, we need to use the QRCodeSVG component properly
      // This is a simplified version - the actual implementation should use React rendering
      document.body.removeChild(container);
      resolve(''); // Placeholder
    });
  });
}
