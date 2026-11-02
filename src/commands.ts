import type BrainPlugin from './main';
import { BrainView } from './ui/view';
import { shortcutActions } from './shortcuts';

/** Existing command IDs remain stable; additional actions are available to Obsidian's command palette. */
export function registerBrainCommands(plugin: BrainPlugin): void {
  for (const action of shortcutActions) {
    if (['create', 'home', 'undo', 'redo'].includes(action.id)) continue;
    plugin.addCommand({id: `canvas-${action.id}`, name: action.label, checkCallback: checking => {
      const view = plugin.app.workspace.getActiveViewOfType(BrainView);
      if (!view) return false;
      if (!checking) view.runShortcut(action.id);
      return true;
    }});
  }
}
