"""Repo-keyed graph store (TRD §3.1 — resolves the single-global-graph bug).

The old module-level GRAPH_STORE/GRAPH_DATA globals meant one graph for one
repo at a time — actively wrong for a product where many users analyze many
repos concurrently. This store keys graphs by repo id, persists each to disk
(the same fix packages/retrieval already made once — never again reintroduce
the "lost on restart" bug), and keeps only a bounded LRU in memory. Evicted
graphs reload transparently from disk on next access.
"""

import json
import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path

from codegraph_parser import Edge, GraphData, GraphStore, Node

logger = logging.getLogger(__name__)

_STORAGE_DIR = Path(os.getenv("CODEGRAPH_STORAGE_DIR", "/tmp/vibecoder-codegraph"))

# Bound on graphs held in memory; anything older is evicted (and reloaded
# from disk if asked for again). Generous: a parsed graph is small relative
# to an LLM completion, but unbounded growth in a long-lived service is how
# the next out-of-memory incident gets filed.
_MAX_IN_MEMORY = int(os.getenv("CODEGRAPH_MAX_IN_MEMORY", "20"))

_lock = threading.Lock()
# (store, graph) pairs: the GraphStore answers queries; the GraphData is kept
# for cheap serialization/counts without a to_graph_data() round-trip.
_graphs: OrderedDict[str, tuple[GraphStore, GraphData]] = OrderedDict()
_paths: dict[str, str] = {}


def _repo_file(repo_id: str) -> Path:
    # Sanitize: repo ids are uuid-ish today, but a path-traversal-safe join
    # costs nothing and the endpoint accepts arbitrary strings.
    safe = repo_id.replace("/", "_").replace("\\", "_").replace("..", "_")
    return _STORAGE_DIR / f"{safe}.json"


def _ensure_storage_dir() -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def _deserialize(data: dict) -> tuple[GraphStore, GraphData]:
    graph = GraphData(
        nodes=[Node(**n) for n in data.get("nodes", [])],
        edges=[Edge(**e) for e in data.get("edges", [])],
    )
    return GraphStore(graph), graph


def save_graph(repo_id: str, repo_path: str, store: GraphStore, graph: GraphData) -> None:
    """Insert/replace the graph for `repo_id`, persisting to disk first."""
    _ensure_storage_dir()
    payload = {
        "repo_path": repo_path,
        "nodes": [n.__dict__ for n in graph.nodes],
        "edges": [e.__dict__ for e in graph.edges],
    }
    tmp = _repo_file(repo_id).with_suffix(".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(_repo_file(repo_id))  # atomic-enough: no torn reads

    with _lock:
        _paths[repo_id] = repo_path
        _graphs[repo_id] = (store, graph)
        _graphs.move_to_end(repo_id)
        while len(_graphs) > _MAX_IN_MEMORY:
            evicted, _ = _graphs.popitem(last=False)
            logger.info(f"[codegraph] evicted graph {evicted} from memory (persisted on disk)")


def load_graph(repo_id: str) -> tuple[GraphStore, GraphData] | None:
    """The graph for `repo_id`: from memory, else reloaded from disk."""
    with _lock:
        entry = _graphs.get(repo_id)
        if entry is not None:
            _graphs.move_to_end(repo_id)
            return entry
    return _load_from_disk(repo_id)


def _load_from_disk(repo_id: str) -> tuple[GraphStore, GraphData] | None:
    path = _repo_file(repo_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        store, graph = _deserialize(data)
        _paths[repo_id] = data.get("repo_path", "")
        with _lock:
            _graphs[repo_id] = store
            _graphs.move_to_end(repo_id)
            while len(_graphs) > _MAX_IN_MEMORY:
                _graphs.popitem(last=False)
        return store, graph
    except (json.JSONDecodeError, OSError, TypeError) as e:
        logger.warning(f"[codegraph] failed to reload graph {repo_id} from disk: {e}")
        return None


def delete_graph(repo_id: str) -> bool:
    """Drop a repo's graph from memory and disk. True if a file existed."""
    with _lock:
        _graphs.pop(repo_id, None)
        _paths.pop(repo_id, None)
    path = _repo_file(repo_id)
    if path.exists():
        path.unlink()
        return True
    return False


def graph_repo_path(repo_id: str) -> str | None:
    """Best-effort: where the repo was cloned when parsed (for doc/file reads)."""
    with _lock:
        if repo_id in _paths:
            return _paths[repo_id]
    data = _load_from_disk(repo_id)
    if data is not None:
        return _paths.get(repo_id)
    return None
