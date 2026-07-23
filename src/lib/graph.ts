import type { BoardColumn, BoardTask } from './board-types';

export interface GraphNode {
  id: string;
  title: string;
  columnName: string;
  isDone: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
}

export interface LayoutEdge extends GraphEdge {
  points: LayoutPoint[];
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export type GraphResult = { kind: 'cycle' } | { kind: 'ok'; layout: GraphLayout };

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

export function buildGraph(
  tasks: readonly BoardTask[],
  columns: readonly BoardColumn[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const nodes = tasks.map((task) => {
    const column = columnById.get(task.column_id);
    return {
      id: task.id,
      title: task.title,
      columnName: column?.name ?? '',
      isDone: column?.is_done ?? false,
    };
  });
  const taskIds = new Set(tasks.map((task) => task.id));
  const edges: GraphEdge[] = [];
  for (const task of tasks) {
    for (const blockerId of new Set(task.blocker_ids)) {
      if (!taskIds.has(blockerId)) continue;
      edges.push({ id: edgeId(blockerId, task.id), from: blockerId, to: task.id });
    }
  }
  return { nodes, edges };
}

interface Adjacency {
  out: Map<string, string[]>;
  indegree: Map<string, number>;
}

function adjacency(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Adjacency {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const out = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
    out.get(edge.from)!.push(edge.to);
  }
  return { out, indegree };
}

function topologicalOrder(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string[] {
  const { out, indegree } = adjacency(nodes, edges);
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}

export function detectCycle(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): boolean {
  return topologicalOrder(nodes, edges).length < nodes.length;
}

function fmt(point: LayoutPoint): string {
  return `${Math.round(point.x * 100) / 100} ${Math.round(point.y * 100) / 100}`;
}

// Catmull-Rom through the dagre waypoints, converted to cubic Bezier segments.
export function edgePath(points: readonly LayoutPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${fmt(points[0]!)}`;
  const parts = [`M ${fmt(points[0]!)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(`C ${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`);
  }
  return parts.join(' ');
}
