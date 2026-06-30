import { describe, it, expect } from 'vitest';
import { styleFor } from '../src/theme';

describe('styleFor', () => {
  it('classic uses emoji glyphs and classic color ids', () => {
    expect(styleFor('classic', 'running')).toEqual({
      colorId: 'claudeSemaphore.classic.running',
      icon: 'sync~spin',
      summaryGlyph: '🟢',
    });
    expect(styleFor('classic', 'needsInput').summaryGlyph).toBe('🟡');
    expect(styleFor('classic', 'stopped').summaryGlyph).toBe('🔴');
  });

  it('colorblind uses codicon glyphs and colorblind color ids', () => {
    const s = styleFor('colorblind', 'needsInput');
    expect(s.colorId).toBe('claudeSemaphore.colorblind.needsInput');
    expect(s.icon).toBe('warning');
    expect(s.summaryGlyph).toBe('$(warning)');
  });

  it('every state has a distinct icon shape', () => {
    const icons = (['running', 'needsInput', 'stopped'] as const).map((st) => styleFor('classic', st).icon);
    expect(new Set(icons).size).toBe(3);
  });

  it('highContrast has no colorId and uses codicon glyph', () => {
    const s = styleFor('highContrast', 'stopped');
    expect(s.colorId).toBeUndefined();
    expect(s.summaryGlyph).toBe('$(circle-large-filled)');
  });
});
