import sys
from pathlib import Path
from .parser import parse_repo


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m codegraph_parser <repo_path> [output.json]")
        sys.exit(1)

    repo_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "graph.json"

    print(f"Parsing {repo_path}...")
    graph = parse_repo(repo_path)
    graph.save(output_path)
    print(f"Saved graph with {len(graph.nodes)} nodes and {len(graph.edges)} edges to {output_path}")


if __name__ == "__main__":
    main()