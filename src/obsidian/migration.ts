import {getFrontMatterInfo, parseYaml, stringifyYaml, type App} from 'obsidian';

/** Failed migrations retain their properties, but those properties never become live relations. */
export const isLegacyProperty = (key: string): boolean => /^(brain-parents|brain-jumps)(?:$|\.|\[)/.test(key);

export function migrateLegacyContent(content: string, bodyLinks: Iterable<string> = []): string {
  const info = getFrontMatterInfo(content);
  if (!info.exists) {
    if (/^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(content)) throw new Error('YAML 属性未正确结束');
    return content;
  }
  const value: unknown = parseYaml(info.frontmatter);
  if (value == null) return content;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('YAML 属性必须是对象');
  const properties = {...value as Record<string, unknown>};
  if (!('brain-parents' in properties) && !('brain-jumps' in properties)) return content;
  const jumps = properties['brain-jumps'];
  if (jumps !== undefined && (!Array.isArray(jumps) || jumps.some(entry =>
    typeof entry !== 'string' || !/^\[\[[^\][\r\n]+\]\]$/.test(entry.trim()) || !entry.trim().slice(2, -2).split('|')[0]?.split('#')[0]?.trim()))) {
    throw new Error('brain-jumps 包含无效链接，原内容已保留');
  }
  const existing = new Set([...bodyLinks].map(link => link.trim()));
  const additions: string[] = [];
  for (const entry of (jumps ?? []) as string[]) {
    const link = entry.trim(), key = link.slice(2, -2);
    if (!existing.has(key)) {additions.push(link); existing.add(key);}
  }
  delete properties['brain-jumps']; delete properties['brain-parents'];
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = content.slice(info.contentStart);
  const header = Object.keys(properties).length ? `---${eol}${stringifyYaml(properties).replace(/\r?\n/g, eol)}---${eol}` : '';
  const suffix = additions.length ? `${body.endsWith(eol + eol) || !body ? '' : body.endsWith(eol) ? eol : eol + eol}${additions.join(eol)}${eol}` : '';
  return `${content.startsWith('\uFEFF') ? '\uFEFF' : ''}${header}${body}${suffix}`;
}

/** Atomic per file and resumable: successful files no longer contain the legacy keys. */
export async function migrateLegacyRelations(app: App, active = () => true): Promise<{migrated: number; errors: string[]}> {
  let migrated = 0;
  const errors: string[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!active()) break;
    try {
      const original = await app.vault.read(file);
      if (!/brain-(?:parents|jumps)\s*:/.test(original)) continue;
      const cache = app.metadataCache.getFileCache(file);
      if (!cache) throw new Error('笔记元数据尚未就绪，重载后重试迁移');
      // A stale cache must never convince migration to discard a link missing from the body.
      const references = [...(cache.links ?? []), ...(cache.embeds ?? [])].filter(link =>
        link.position && original.slice(link.position.start.offset, link.position.end.offset) === link.original);
      const next = migrateLegacyContent(original, references.map(link => link.link));
      if (next === original) continue;
      if (!active()) break;
      await app.vault.process(file, current => {
        if (current !== original) throw new Error('笔记已被外部修改，请重试迁移');
        return next;
      });
      migrated++;
    } catch (error) {errors.push(`${file.path}：${error instanceof Error ? error.message : String(error)}`);}
  }
  return {migrated, errors};
}
