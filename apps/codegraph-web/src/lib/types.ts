export interface GraphNode {
  id: string;
  type: string;
  file: string;
  name: string;
  line_start: number;
  line_end: number;
  docstring?: string | null;
  signature?: string | null;
}

export interface GraphEdge {
  from_id: string;
  to_id: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
