export interface MindMapSettings {
  showIcons: boolean;
  showGroupLabels: boolean;
  fontSize: number;
  spacing: 'compact' | 'standard' | 'spacious';
  foldLimit: number;
  lineLength: number;
  lineWidth: number;
  lineOpacity: number;
}
export const DEFAULT_MIND_MAP: Readonly<MindMapSettings> = Object.freeze({
  showIcons: true, showGroupLabels: true,
  fontSize: 16, spacing: 'standard', foldLimit: 6, lineLength: 100, lineWidth: 100, lineOpacity: 100,
});
export function loadMindMapSettings(raw: unknown): MindMapSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const result = {...DEFAULT_MIND_MAP};
  for (const key of ['showIcons', 'showGroupLabels'] as const) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (value.spacing === 'compact' || value.spacing === 'standard' || value.spacing === 'spacious') result.spacing = value.spacing;
  for (const [key, min, max] of [['fontSize', 12, 24], ['foldLimit', 3, 20], ['lineLength', 50, 200], ['lineWidth', 50, 200], ['lineOpacity', 20, 100]] as const) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.max(min, Math.min(max, Math.round(number)));
  }
  return result;
}
