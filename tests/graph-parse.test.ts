import {describe, expect, it} from 'vitest';
import {parseCachedNote, type LinkResolver} from '../src/graph/parse';

const resolve: LinkResolver = (link, source) => {
  if (link === 'Missing' || link.endsWith('.png')) return null;
  return link.includes('/') ? link.replace(/\.md$/, '') + '.md' : source.slice(0, source.lastIndexOf('/') + 1) + link.replace(/\.md$/, '') + '.md';
};

describe('native internal links', () => {
  it('unifies body, embeds and frontmatter links with source-relative resolution', () => {
    const parsed = parseCachedNote('Folder/A.md', 'A', {
      frontmatter: {icon: '💡'}, links: [{link: 'B#Heading|Alias'}, {link: 'B'}, {link: 'Elsewhere/B'}],
      embeds: [{link: 'C#^block'}], frontmatterLinks: [{key: 'related.0', link: 'D'}],
    }, resolve);
    expect(parsed.record.links).toEqual(['Folder/B.md', 'Elsewhere/B.md', 'Folder/C.md', 'Folder/D.md']);
    expect(parsed.record.parents).toEqual([]); expect(parsed.record.icon).toBe('💡');
    expect(parsed.record).not.toHaveProperty('jumps');
  });
  it('ignores self-links and excludes unresolved destinations from connected notes', () => {
    const result = parseCachedNote('Folder/A.md', 'A', {links: [{link: 'A'}, {link: '#Heading'}, {link: 'Missing'}, {link: 'asset.png'}]}, resolve);
    expect(result.record.links).toEqual([]); expect(result.unresolved).toEqual(['Missing', 'asset.png']);
  });
  it('leaves failed migration properties inert without reserving unrelated property names', () => {
    const metadata = {frontmatterLinks: [{key: 'brain-parents.0', link: 'B'}, {key: 'brain-jumps[0]', link: 'C'}, {key: 'brain-parents-extra.0', link: 'D'}]};
    const before = JSON.stringify(metadata);
    expect(parseCachedNote('Folder/A.md', 'A', metadata, resolve).record.links).toEqual(['Folder/D.md']);
    expect(JSON.stringify(metadata)).toBe(before);
  });
  it('does not infer connections from text or arbitrary frontmatter strings', () => {
    expect(parseCachedNote('A.md', 'A', {frontmatter: {example: '[[B]]'}}, resolve).record.links).toEqual([]);
    expect(parseCachedNote('A.md', 'A', null, resolve).record.issues).toHaveLength(1);
  });
});
