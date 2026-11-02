import {describe, expect, it} from 'vitest';
import {GraphIndex} from '../src/graph';
import {directoryRecords} from '../src/graph/directory';
import type {NoteRecord} from '../src/model/types';
import {graphStatistics, isolatedNotes} from '../src/ui/statistics';

const note = (id: string, changes: Partial<NoteRecord> = {}): NoteRecord => ({
  id, title: id.replace(/\.md$/, ''), parents: [], links: [], issues: [], ...changes,
});

describe('directory isolation', () => {
  it('counts notes without note links as isolated even when they have directory parents or children', () => {
    const graph = new GraphIndex(directoryRecords('知识库', ['项目', '空目录'], [
      note('项目/项目.md'), note('项目/任务.md'), note('根目录笔记.md'),
    ]));
    expect(isolatedNotes(graph).map(item => item.id)).toEqual(['根目录笔记.md', '项目/任务.md', '项目/项目.md']);
    expect(graphStatistics(graph)).toBe('共 3 篇笔记 · 2 个文件夹 · 孤立笔记 3 篇');
  });

  it('excludes both ends of incoming links and jumps, including merged folder notes', () => {
    const graph = new GraphIndex(directoryRecords('知识库', ['项目'], [
      note('项目/项目.md'), note('来信.md', {links: ['项目/项目.md']}),
      note('跳转.md', {links: ['项目/项目.md']}), note('独立.md'),
    ]));
    expect(isolatedNotes(graph).map(item => item.id)).toEqual(['独立.md']);
    expect(graphStatistics(graph)).toContain('孤立笔记 1 篇');
  });
});
