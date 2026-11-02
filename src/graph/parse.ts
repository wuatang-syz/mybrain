import type {NoteId, NoteRecord} from '../model/types';
import {isLegacyProperty} from '../obsidian/migration';

export interface NoteMetadata {
  frontmatter?: Record<string, unknown>;
  links?: {link: string}[];
  embeds?: {link: string}[];
  frontmatterLinks?: {key: string; link: string}[];
}
export type LinkResolver = (linkpath: string, sourcePath: string) => NoteId | null;
export interface ParsedNote {record: NoteRecord; unresolved: string[]}

/** The host cache excludes code examples and identifies actual internal references. */
export function parseCachedNote(id: NoteId, title: string, cache: NoteMetadata | null, resolve: LinkResolver): ParsedNote {
  const record: NoteRecord = {id, title, parents: [], links: [], issues: []};
  if (typeof cache?.frontmatter?.icon === 'string' && cache.frontmatter.icon) record.icon = cache.frontmatter.icon;
  const unresolved = new Set<string>();
  if (!cache) {
    record.issues.push('笔记元数据尚未解析，关系将在索引完成后显示');
    return {record, unresolved: []};
  }
  const references = [...(cache.links ?? []), ...(cache.embeds ?? []),
    ...(cache.frontmatterLinks ?? []).filter(link => !isLegacyProperty(link.key))];
  for (const link of references) {
    const path = link.link.split('|')[0]?.split('#')[0]?.trim();
    if (!path) continue;
    const target = resolve(path, id);
    if (!target) unresolved.add(path);
    else if (target !== id && !record.links.includes(target)) record.links.push(target);
  }
  return {record, unresolved: [...unresolved]};
}
