import type {NoteRecord} from '../model/types';

export const VAULT_ROOT = '/';
export const parentPath = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const joinPath = (parent: string, name: string): string => parent && parent !== '/' ? `${parent}/${name}` : name;
export const renamePath = (path: string, from: string, to: string): string =>
  path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;

/** Folders and Markdown files retain separate identities in the real directory tree. */
export function directoryRecords(name: string, folders: string[], notes: NoteRecord[]): NoteRecord[] {
  const paths = new Set(folders.filter(path => path && path !== '/'));
  for (const path of [...paths, ...notes.map(note => note.id)]) {
    let parent = parentPath(path);
    while (parent) {paths.add(parent); parent = parentPath(parent);}
  }
  const result: NoteRecord[] = [{id: VAULT_ROOT, kind: 'root', path: '', title: name, icon: '🧠', parents: [], links: [], issues: []}];
  for (const path of paths) {
    result.push({id: path, path, kind: 'folder', title: path.split('/').pop()!, icon: '📁',
      parents: [parentPath(path) || VAULT_ROOT], issues: [], links: []});
  }
  for (const note of notes) result.push({...note, kind: 'note', path: note.id, notePath: note.id,
    parents: [parentPath(note.id) || VAULT_ROOT]});
  return result;
}
