import { SemaphoreState, ThemeName } from './types';

export interface StateStyle {
  colorId?: string;
  icon: string;
  summaryGlyph: string;
}

const ICONS: Record<SemaphoreState, string> = {
  running: 'sync~spin',
  needsInput: 'warning',
  stopped: 'circle-large-filled',
};

const EMOJI: Record<SemaphoreState, string> = {
  running: '🟢',
  needsInput: '🟡',
  stopped: '🔴',
};

export function styleFor(theme: ThemeName, state: SemaphoreState): StateStyle {
  const icon = ICONS[state];
  if (theme === 'highContrast') {
    return { colorId: undefined, icon, summaryGlyph: `$(${icon})` };
  }
  return {
    colorId: `claudeSemaphore.${theme}.${state}`,
    icon,
    summaryGlyph: theme === 'colorblind' ? `$(${icon})` : EMOJI[state],
  };
}
