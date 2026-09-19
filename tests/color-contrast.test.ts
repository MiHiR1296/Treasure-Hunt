import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, relativeLuminance, themeTextColor } from '../lib/utils/colorContrast';

test('contrast uses linearized sRGB and actual foreground colors', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.ok(Math.abs(contrastRatio('#ff0000', '#ffffff') - 3.9984767707539985) < 0.00001);
  assert.equal(themeTextColor('#FFFFFF'), '#1c1917');
  assert.equal(themeTextColor('#065f46'), '#ffffff');
  assert.ok(contrastRatio('#ff0000', themeTextColor('#ff0000')) >= 4.5);
  assert.ok(contrastRatio('#00aa00', themeTextColor('#00aa00')) >= 4.5);
  assert.ok(contrastRatio('#7b7b7b', '#ffffff') < 4.5);
  assert.ok(contrastRatio('#7b7b7b', '#1c1917') < 4.5);
  assert.equal(themeTextColor('#7b7b7b'), '#000000');
  assert.throws(() => relativeLuminance('#fff'));
});

test('theme text meets 4.5:1 across neutral values and a representative full RGB lattice', () => {
  const hex = (red: number, green: number, blue: number) => `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`;
  const verify = (background: string) => assert.ok(contrastRatio(background, themeTextColor(background)) >= 4.5, background);
  for (let grey = 0; grey <= 255; grey++) verify(hex(grey, grey, grey));
  for (let red = 0; red <= 255; red += 17) for (let green = 0; green <= 255; green += 17) for (let blue = 0; blue <= 255; blue += 17) verify(hex(red, green, blue));
});
