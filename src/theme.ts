import { SemaphoreState, ThemeName } from './types';

export interface StateStyle {
  colorId?: string;
  icon: string;
  summaryGlyph: string;
}

const ICONS: Record<SemaphoreState, string> = {
  unknown: 'question',
  running: 'sync~spin',
  needsInput: 'warning',
  stopped: 'circle-large-filled',
  error: 'error',
};

const EMOJI: Record<SemaphoreState, string> = {
  unknown: '⚪',
  running: '🟢',
  needsInput: '🟡',
  stopped: '⚪',
  error: '🔴',
};

export function styleFor(theme: ThemeName, state: SemaphoreState): StateStyle {
  const icon = ICONS[state];
  if (theme === 'highContrast' || state === 'unknown') {
    return { colorId: undefined, icon, summaryGlyph: `$(${icon})` };
  }
  return {
    colorId: `claudeSemaphore.${theme}.${state}`,
    icon,
    summaryGlyph: theme === 'colorblind' ? `$(${icon})` : EMOJI[state],
  };
}
