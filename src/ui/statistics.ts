import type { GraphAccess, NoteRecord } from '../model/types';

/** Directory edges organize notes; only note-to-note references determine isolation. */
export function isolatedNotes(graph: GraphAccess): NoteRecord[] {
  return graph.all().filter(note => !!note.notePath && !graph.linked(note.id).length);
}

export function graphStatistics(graph: GraphAccess): string {
  const notes = graph.all();
  return `共 ${notes.filter(note => note.notePath).length} 篇笔记 · ${notes.filter(note => note.kind === 'folder').length} 个文件夹 · 孤立笔记 ${isolatedNotes(graph).length} 篇`;
}
