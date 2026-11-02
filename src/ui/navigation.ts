import type { GraphAccess } from '../model/types';

export function rootPaths(graph: GraphAccess, root: string | null): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  if (!root || !graph.get(root)) return paths;
  paths.set(root, [root]);
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    for (const next of graph.children(id)) {
      if (paths.has(next)) continue;
      paths.set(next, [...paths.get(id)!, next]); queue.push(next);
    }
  }
  return paths;
}
