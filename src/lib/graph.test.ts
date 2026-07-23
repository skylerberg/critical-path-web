import { describe, expect, it } from 'vitest';
import type { BoardColumn, BoardTask } from './board-types';
import { buildGraph, detectCycle, edgeId, edgePath, type GraphEdge, type GraphNode } from './graph';

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

describe('buildGraph', () => {
  it('maps tasks to nodes with column name and done flag', () => {
    const { nodes } = buildGraph([task('a', 'todo'), task('b', 'done')], columns);

    expect(nodes).toEqual([
      { id: 'a', title: 'Task a', columnName: 'To Do', isDone: false },
      { id: 'b', title: 'Task b', columnName: 'Done', isDone: true },
    ]);
  });

  it('creates blocker -> blocked edges from blocker_ids', () => {
    const { edges } = buildGraph([task('a', 'todo'), task('b', 'todo', ['a'])], columns);

    expect(edges).toEqual([{ id: 'a->b', from: 'a', to: 'b' }]);
  });

  it('skips blockers that are not in the task set and duplicate blocker ids', () => {
    const { edges } = buildGraph(
      [task('a', 'todo'), task('b', 'todo', ['a', 'a', 'missing'])],
      columns
    );

    expect(edges).toEqual([{ id: 'a->b', from: 'a', to: 'b' }]);
  });

  it('handles tasks whose column is unknown', () => {
    const { nodes } = buildGraph([task('a', 'gone')], columns);

    expect(nodes).toEqual([{ id: 'a', title: 'Task a', columnName: '', isDone: false }]);
  });
});

describe('detectCycle', () => {
  it('accepts a chain', () => {
    const nodes = [node('a'), node('b'), node('c')];
    expect(detectCycle(nodes, [edge('a', 'b'), edge('b', 'c')])).toBe(false);
  });

  it('accepts a diamond', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(detectCycle(nodes, edges)).toBe(false);
  });

  it('flags a two-node cycle and terminates', () => {
    const nodes = [node('a'), node('b')];
    expect(detectCycle(nodes, [edge('a', 'b'), edge('b', 'a')])).toBe(true);
  });

  it('flags a self-loop', () => {
    expect(detectCycle([node('a')], [edge('a', 'a')])).toBe(true);
  });

  it('flags a cycle reachable only from part of the graph', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'b'), edge('a', 'd')];
    expect(detectCycle(nodes, edges)).toBe(true);
  });
});

describe('edgePath', () => {
  it('returns an empty string for no points', () => {
    expect(edgePath([])).toBe('');
  });

  it('builds a single cubic segment between two points', () => {
    const d = edgePath([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);

    expect(d).toBe('M 0 0 C 16.67 8.33 83.33 41.67 100 50');
  });

  it('builds one cubic segment per span with finite numbers', () => {
    const d = edgePath([
      { x: 0, y: 0 },
      { x: 50, y: 80 },
      { x: 120, y: 20 },
      { x: 200, y: 60 },
    ]);

    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(3);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
