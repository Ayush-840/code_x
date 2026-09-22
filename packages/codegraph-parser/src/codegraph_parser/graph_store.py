import networkx as nx
from typing import Optional
from .parser import GraphData, Node, Edge


class GraphStore:
    def __init__(self, graph_data: GraphData):
        self.graph = nx.DiGraph()
        self._build_graph(graph_data)

    def _build_graph(self, graph_data: GraphData) -> None:
        for node in graph_data.nodes:
            self.graph.add_node(node.id, **node.__dict__)
        for edge in graph_data.edges:
            self.graph.add_edge(edge.from_id, edge.to_id, type=edge.type)

        # Defensive: parser guarantees ids, but never trust a dangling edge —
        # an endpoint without a node would break subgraph/explain queries.
        dangling = [
            (u, v)
            for u, v in self.graph.edges
            if u not in self.graph or v not in self.graph
        ]
        for u, v in dangling:
            self.graph.remove_edge(u, v)

    def get_neighbors(self, node_id: str, depth: int = 1) -> list[str]:
        if node_id not in self.graph:
            return []
        neighbors: set[str] = set()
        current = {node_id}
        for _ in range(depth):
            next_level: set[str] = set()
            for n in current:
                next_level.update(self.graph.successors(n))
                next_level.update(self.graph.predecessors(n))
            neighbors.update(next_level)
            current = next_level
        neighbors.discard(node_id)
        return sorted(neighbors)

    def get_subgraph_for_query(self, keywords: list[str], max_nodes: int = 20) -> list[str]:
        scored: dict[str, int] = {}
        for node_id, data in self.graph.nodes(data=True):
            score = 0
            name = str(data.get("name", "")).lower()
            file = str(data.get("file", "")).lower()
            docstring = str(data.get("docstring") or "").lower()
            for kw in keywords:
                kw_lower = kw.lower()
                if kw_lower in name:
                    score += 3
                if kw_lower in file:
                    score += 2
                if kw_lower in docstring:
                    score += 1
            if score > 0:
                scored[node_id] = score

        seeds = sorted(scored.keys(), key=lambda k: scored[k], reverse=True)[:5]

        expanded: set[str] = set(seeds)
        for seed in seeds:
            expanded.update(self.get_neighbors(seed, depth=2))

        return list(expanded)[:max_nodes]

    def get_node_data(self, node_id: str) -> Optional[dict]:
        if node_id in self.graph:
            return dict(self.graph.nodes[node_id])
        return None

    def to_graph_data(self) -> GraphData:
        nodes = []
        edges = []
        for node_id, data in self.graph.nodes(data=True):
            nodes.append(Node(**{k: v for k, v in data.items() if k in Node.__annotations__}))
        for u, v, data in self.graph.edges(data=True):
            edges.append(Edge(from_id=u, to_id=v, type=data.get("type", "")))
        return GraphData(nodes=nodes, edges=edges)
