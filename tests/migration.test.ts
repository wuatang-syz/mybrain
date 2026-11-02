import {describe, expect, it, vi} from 'vitest';
import type {App} from 'obsidian';
import {migrateLegacyContent, migrateLegacyRelations} from '../src/obsidian/migration';

describe('legacy relation migration', () => {
  it('preserves properties and body, including aliases and heading/block links', () => {
    const original = '---\nicon: 💡\ntags: [one]\nbrain-parents: invalid\nbrain-jumps:\n  - "[[B|Alias]]"\n  - "[[C#Heading]]"\n  - "[[D#^block]]"\n  - "[[Missing]]"\n---\noriginal';
    const next = migrateLegacyContent(original);
    expect(next).toContain('icon: 💡'); expect(next).toContain('one');
    expect(next).toContain('original\n\n[[B|Alias]]\n[[C#Heading]]\n[[D#^block]]\n[[Missing]]\n');
    expect(next).not.toContain('brain-parents'); expect(next).not.toContain('brain-jumps');
    expect(migrateLegacyContent(next)).toBe(next);
  });
  it('deduplicates existing real links and repeated legacy entries', () => {
    const original = '---\nbrain-jumps: ["[[B]]", "[[B]]", "[[C]]"]\n---\n[[B]]';
    const next = migrateLegacyContent(original, ['B']);
    expect(next.match(/\[\[B\]\]/g)).toHaveLength(1);
    expect(next.match(/\[\[C\]\]/g)).toHaveLength(1);
  });
  it('preserves CRLF and removes old parents without manufacturing links', () => {
    expect(migrateLegacyContent('---\r\nbrain-parents: ["[[P]]"]\r\n---\r\nbody')).toBe('body');
    const next = migrateLegacyContent('---\r\nbrain-jumps: ["[[B]]"]\r\n---\r\nbody');
    expect(next).toBe('body\r\n\r\n[[B]]\r\n');
  });
  it.each([
    '---\nbrain-jumps: [',
    '---\nbrain-jumps: invalid\n---\nbody',
    '---\nbrain-jumps: ["[[B]]", 12]\n---\nbody',
    '---\nbrain-jumps: ["[[#Heading]]"]\n---\nbody',
    '---\nbrain-jumps: ["[[B]]"\n---\nbody',
  ])('rejects malformed content as a complete per-file operation', content => {
    expect(() => migrateLegacyContent(content)).toThrow();
  });
  it('retries failed files after interrupted migration without duplicating completed files', async () => {
    const documents = new Map([['A.md', '---\nbrain-jumps: ["[[B]]"]\n---\na'], ['B.md', '---\nbrain-jumps: invalid\n---\nb']]);
    const process = vi.fn(async (file: {path: string}, change: (text: string) => string) => {
      documents.set(file.path, change(documents.get(file.path)!));
    });
    const app = {vault: {getMarkdownFiles: () => [...documents.keys()].map(path => ({path})),
      read: async (file: {path: string}) => documents.get(file.path)!, process},
      metadataCache: {getFileCache: () => ({})}} as unknown as App;
    const first = await migrateLegacyRelations(app);
    expect(first.migrated).toBe(1); expect(first.errors[0]).toContain('B.md');
    expect(documents.get('B.md')).toContain('invalid');
    documents.set('B.md', '---\nbrain-jumps: ["[[C]]"]\n---\nb');
    expect(await migrateLegacyRelations(app)).toEqual({migrated: 1, errors: []});
    expect(process).toHaveBeenCalledTimes(2);
    expect(documents.get('A.md')?.match(/\[\[B\]\]/g)).toHaveLength(1);
  });
  it('does not overwrite a concurrent edit', async () => {
    let content = '---\nbrain-jumps: ["[[B]]"]\n---\na';
    const app = {vault: {getMarkdownFiles: () => [{path: 'A.md'}], read: async () => content,
      process: async (_file: unknown, change: (text: string) => string) => {content = 'external'; content = change(content);}},
      metadataCache: {getFileCache: () => ({})}} as unknown as App;
    const result = await migrateLegacyRelations(app);
    expect(content).toBe('external'); expect(result.migrated).toBe(0); expect(result.errors[0]).toContain('A.md');
  });
  it('retains links when a stale cache describes content no longer present', async () => {
    let content = '---\nbrain-jumps: ["[[B]]"]\n---\nbody';
    const app = {vault: {getMarkdownFiles: () => [{path: 'A.md'}], read: async () => content,
      process: async (_file: unknown, change: (text: string) => string) => {content = change(content);}},
      metadataCache: {getFileCache: () => ({links: [{link: 'B', original: '[[B]]', position: {start: {offset: 0}, end: {offset: 5}}}]})}} as unknown as App;
    expect(await migrateLegacyRelations(app)).toEqual({migrated: 1, errors: []});
    expect(content).toContain('body\n\n[[B]]');
  });
});
