import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import type { EdgeLabel, GraphLabel, NodeLabel } from '@dagrejs/dagre';
import type { BoardColumn, BoardTask } from './board-types';
import { buildGraph, detectCycle } from './graph';
import type { GraphEdge, GraphLayout, GraphNode, GraphResult } from './graph';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
const NODE_SEP = 24;
const RANK_SEP = 72;

export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const g = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }
  dagreLayout(g);
  const positioned = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return { ...node, x: x ?? 0, y: y ?? 0 };
  });
  const positionedEdges = edges.map((edge) => ({
    ...edge,
    points: (g.edge(edge.from, edge.to).points ?? []).map((p) => ({ x: p.x, y: p.y })),
  }));
  const label = g.graph();
  return {
    nodes: positioned,
    edges: positionedEdges,
    width: label.width ?? 0,
    height: label.height ?? 0,
  };
}

export function computeGraph(
  tasks: readonly BoardTask[],
  columns: readonly BoardColumn[]
): GraphResult {
  const { nodes, edges } = buildGraph(tasks, columns);
  if (detectCycle(nodes, edges)) {
    return { kind: 'cycle' };
  }
  return { kind: 'ok', layout: layoutGraph(nodes, edges) };
}
