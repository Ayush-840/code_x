"""Sanitize chunk text before embedding/indexing.

The production embedding model (nemotron-3-embed-1b) is multimodal: its
request sniffer treats ``data:image/...;base64,...`` strings *inside the
text* as image inputs and rejects the call with
"image inputs require VLM serving to be enabled on this server" (HTTP 400).
Repos that inline images in source (portfolio sites, generated clients)
trip this on every analysis.

We replace base64 data-URIs with a short placeholder so:
- the embedder sees plain text and never 400s,
- a giant blob can't drown the surrounding code within the 8000-char
  truncation window,
- BM25 and the LLM grounding context aren't polluted with base64 noise.

The replacement stays on the same line, so chunk line ranges remain valid.
"""

import re

# data:<mime>;base64,<payload> — payloads run to whitespace/quote/end.
_DATA_URI_RE = re.compile(
    r"data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]{16,}"
)

# Any long raw base64 run (>=64 chars, no whitespace) — catches blobs that
# were inlined without a data: prefix (e.g. in JSON fixtures).
_B64_RUN_RE = re.compile(r"[A-Za-z0-9+/]{64,}={0,2}")

_PLACEHOLDER = "[inline image data omitted]"


def sanitize_chunk_text(text: str) -> str:
    """Replace embedded base64 payloads with a placeholder. Same-line,
    content-preserving (the code around the blob survives intact)."""
    if "base64," not in text and not _B64_RUN_RE.search(text):
        return text
    text = _DATA_URI_RE.sub(_PLACEHOLDER, text)
    text = _B64_RUN_RE.sub(_PLACEHOLDER, text)
    return text
