/** WCAG sRGB luminance: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Use a six-digit hexadecimal color.');
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first), b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Keep the preferred stone/white palette, falling back to black for its small midtone gap. */
export function themeTextColor(background: string): '#ffffff' | '#1c1917' | '#000000' {
  const white = contrastRatio(background, '#ffffff');
  const stone = contrastRatio(background, '#1c1917');
  if (Math.max(white, stone) < 4.5) return '#000000';
  return white >= stone ? '#ffffff' : '#1c1917';
}
