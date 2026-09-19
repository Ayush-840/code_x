"""Tests for search tokenization and local embedder."""

from retrieval.search import _tokenize, _ngrams, _LocalDenseEmbedder, _cosine, hashlib_sha1


def test_tokenize_basic():
    tokens = _tokenize("Hello World 123")
    assert "hello" in tokens
    assert "world" in tokens


def test_tokenize_code():
    tokens = _tokenize("def foo_bar():")
    assert "def" in tokens
    assert "foo_bar" in tokens


def test_ngrams():
    tokens = ["a", "b", "c", "d"]
    ngrams = _ngrams(tokens, n=2)
    assert "a#b" in ngrams
    assert "b#c" in ngrams
    assert "c#d" in ngrams


def test_ngrams_single_token():
    ngrams = _ngrams(["hello"], n=2)
    assert "hello" in ngrams


def test_local_embedder_produces_vector():
    embedder = _LocalDenseEmbedder(dim=128)
    vec = embedder.embed("hello world")
    assert len(vec) == 128
    assert all(isinstance(v, float) for v in vec)


def test_local_embedder_normalized():
    embedder = _LocalDenseEmbedder()
    vec = embedder.embed("test text")
    norm = sum(v * v for v in vec) ** 0.5
    assert abs(norm - 1.0) < 1e-6


def test_cosine_identical():
    vec = [1.0, 0.0, 0.0]
    assert _cosine(vec, vec) == 1.0


def test_cosine_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert _cosine(a, b) == 0.0


def test_hashlib_sha1():
    h = hashlib_sha1("hello")
    assert isinstance(h, int)
    assert hashlib_sha1("hello") == hashlib_sha1("hello")
    assert hashlib_sha1("hello") != hashlib_sha1("world")
