import { describe, expect, it } from 'vitest';
import type { BoardColumn, BoardTask } from './board-types';
import { edgeId, type GraphEdge, type GraphNode } from './graph';
import { NODE_HEIGHT, NODE_WIDTH, computeGraph, layoutGraph } from './graph-layout';

function column(id: string, name: string, isDone = false): BoardColumn {
  return { id, name, position: 1000, is_done: isDone };
}

function task(id: string, columnId: string, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: columnId,
    title: `Task ${id}`,
    description: null,
    position: 1000,
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    image_count: 0,
  };
}

const columns = [column('todo', 'To Do'), column('done', 'Done', true)];

function node(id: string, isDone = false): GraphNode {
  return { id, title: `Task ${id}`, columnName: isDone ? 'Done' : 'To Do', isDone };
}

function edge(from: string, to: string): GraphEdge {
  return { id: edgeId(from, to), from, to };
}

describe('layoutGraph', () => {
  it('returns an empty layout for no nodes', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });

  it('positions every node with finite coordinates', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];

    const layout = layoutGraph(nodes, edges);

    expect(layout.nodes).toHaveLength(4);
    for (const positioned of layout.nodes) {
      expect(Number.isFinite(positioned.x)).toBe(true);
      expect(Number.isFinite(positioned.y)).toBe(true);
    }
    expect(layout.width).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it('flows left to right along dependencies', () => {
    const layout = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);

    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(a.x).toBeLessThan(b.x);
  });

  it('returns edge waypoints with finite coordinates', () => {
    const layout = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);

    expect(layout.edges).toHaveLength(1);
    const points = layout.edges[0]!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('computeGraph', () => {
  it('returns a cycle marker without layout on cyclic data', () => {
    const tasks = [task('a', 'todo', ['b']), task('b', 'todo', ['a'])];
    expect(computeGraph(tasks, columns)).toEqual({ kind: 'cycle' });
  });

  it('returns a layout for a DAG', () => {
    const tasks = [task('a', 'todo'), task('b', 'todo', ['a']), task('c', 'done', ['b'])];

    const result = computeGraph(tasks, columns);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.layout.nodes).toHaveLength(3);
    expect(result.layout.edges).toHaveLength(2);
  });
});
