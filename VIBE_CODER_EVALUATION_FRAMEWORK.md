# Vibe Coder Evaluation Framework

## Measuring Retrieval Quality, Answer Accuracy & System Reliability

---

## 1. Framework Overview

### 1.1 Purpose

The evaluation framework serves three objectives:

1. **Quality Assurance** — Ensure that every answer the platform generates is grounded in actual code and factually correct.
2. **Regression Prevention** — Detect quality degradation before it reaches users when models, prompts, or retrieval configurations change.
3. **Continuous Improvement** — Provide measurable signals for tuning retrieval parameters, prompt templates, and model selection.

### 1.2 Evaluation Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVALUATION FRAMEWORK                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: RETRIEVAL QUALITY                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Are we fetching the right code chunks for a query?      │  │
│  │  Metrics: Precision@K, Recall@K, MRR, NDCG@K, Hit Rate  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  Layer 2: GENERATION QUALITY                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Is the generated answer accurate, relevant, and clear?  │  │
│  │  Metrics: Faithfulness, Relevance, Completeness, Tone    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  Layer 3: CITATION ACCURACY                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Do citations actually support the claims made?          │  │
│  │  Metrics: Citation Precision, Citation Recall, Halluc.   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  Layer 4: END-TO-END EXPERIENCE                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Would a candidate find this helpful for interview prep? │  │
│  │  Metrics: Interview Readiness Score, User Satisfaction   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Layer 5: SYSTEM PERFORMANCE                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Is the system fast, reliable, and cost-efficient?       │  │
│  │  Metrics: Latency, Throughput, Error Rate, Cost/Query    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1 — Retrieval Quality

### 2.1 Metrics

#### Precision@K

The fraction of the top-K retrieved chunks that are relevant to the query.

```
Precision@K = |{relevant chunks in top-K}| / K
```

| K | Target | Description |
|---|---|---|
| @3 | ≥ 0.85 | High precision for top results — most critical |
| @5 | ≥ 0.80 | Good precision across the primary context window |
| @10 | ≥ 0.70 | Acceptable for broader context gathering |

**Why it matters:** If the top chunks are irrelevant, the LLM generates answers grounded in wrong code. Precision@3 is the most critical metric because it directly determines the quality of citation-grounded answers.

#### Recall@K

The fraction of all relevant chunks in the repository that appear in the top-K results.

```
Recall@K = |{relevant chunks in top-K}| / |{all relevant chunks in repo}|
```

| K | Target | Description |
|---|---|---|
| @5 | ≥ 0.60 | Covers majority of relevant context |
| @10 | ≥ 0.80 | Comprehensive coverage |
| @20 | ≥ 0.90 | Near-complete coverage for complex queries |

**Why it matters:** Low recall means the system misses relevant code, leading to incomplete answers. A query about "authentication" that misses the token rotation service will produce a shallow answer.

#### Mean Reciprocal Rank (MRR)

The average of the reciprocal ranks of the first relevant result across all queries.

```
MRR = (1/|Q|) × Σ (1 / rank_i)
```

| Target | Description |
|---|---|
| ≥ 0.85 | First relevant result appears in top 1–2 positions on average |

**Why it matters:** Even if precision@K is high, the *order* matters. If the most relevant chunk is at position 5 instead of position 1, the LLM may give less weight to it. MRR captures whether the system ranks the best results first.

#### Normalized Discounted Cumulative Gain (NDCG@K)

Measures ranking quality by assigning higher weight to results that are more relevant and appear earlier.

```
NDCG@K = DCG@K / IDCG@K
DCG@K = Σ (2^relevance_i - 1) / log2(i + 1)
```

Relevance scale: 0 (irrelevant), 1 (partially relevant), 2 (highly relevant), 3 (exact match)

| K | Target | Description |
|---|---|---|
| @5 | ≥ 0.80 | High-quality ranking of top results |
| @10 | ≥ 0.75 | Good ranking across broader results |

**Why it matters:** NDCG rewards systems that rank the *most* relevant chunks highest. A chunk that is an exact code match should rank above a semantically similar but less precise chunk.

#### Hit Rate@K

The fraction of queries where at least one relevant chunk appears in the top-K.

```
Hit Rate@K = |{queries with ≥1 relevant result in top-K}| / |Q|
```

| K | Target | Description |
|---|---|---|
| @5 | ≥ 0.90 | Almost always finds something relevant quickly |
| @10 | ≥ 0.95 | Near-guaranteed relevance coverage |

**Why it matters:** This is the "never fail completely" metric. Even for obscure queries, the system should find at least one relevant chunk.

### 2.2 Hybrid Retrieval Ablation

Test each retrieval component independently to measure its contribution:

| Configuration | Description | Expected Impact |
|---|---|---|
| **Dense only** | Embeddings + cosine similarity | Baseline semantic retrieval |
| **Sparse only** | BM25/TF-IDF keyword search | Baseline exact-match retrieval |
| **Hybrid (RRF)** | Dense + Sparse + Reciprocal Rank Fusion | Full system — should outperform both |
| **Hybrid + Reranker** | Full system + cross-encoder reranking | Best quality — target configuration |

**Ablation test protocol:**
1. Run the same 200-query benchmark against each configuration
2. Compute all metrics for each configuration
3. Verify that Hybrid ≥ max(Dense, Sparse) on all metrics
4. Verify that Hybrid + Reranker ≥ Hybrid on all metrics
5. Measure latency cost of each additional component

Expected results:

```
Configuration        | Precision@5 | Recall@10 | MRR    | NDCG@5 | Latency (ms)
---------------------|-------------|-----------|--------|--------|-------------
Dense only           | 0.72        | 0.65      | 0.78   | 0.68   | 45
Sparse only          | 0.68        | 0.58      | 0.72   | 0.62   | 30
Hybrid (RRF)         | 0.83        | 0.82      | 0.86   | 0.81   | 75
Hybrid + Reranker    | 0.88        | 0.85      | 0.91   | 0.87   | 180
```

### 2.3 Retrieval Benchmark Dataset

A curated set of query-relevance pairs for evaluation. Each entry contains a natural language query and the ground-truth relevant code locations.

**Dataset structure:**

```json
{
  "benchmark_id": "ret_bench_v1",
  "created_at": "2025-09-19",
  "repositories": [
    {
      "repo_name": "portfolio-api",
      "repo_url": "github.com/example/portfolio-api",
      "language": "TypeScript",
      "total_files": 342,
      "queries": [
        {
          "query_id": "q001",
          "query": "How does the authentication middleware validate JWT tokens?",
          "difficulty": "easy",
          "category": "security",
          "relevant_chunks": [
            {
              "file_path": "src/middleware/auth.ts",
              "start_line": 12,
              "end_line": 38,
              "relevance": 3,
              "explanation": "Main JWT validation logic in JwtGuard"
            },
            {
              "file_path": "src/modules/auth/auth.service.ts",
              "start_line": 60,
              "end_line": 85,
              "relevance": 2,
              "explanation": "Token generation with claims and expiry"
            },
            {
              "file_path": "src/config/jwt.ts",
              "start_line": 1,
              "end_line": 20,
              "relevance": 2,
              "explanation": "JWT configuration (secret, algorithms, expiry)"
            }
          ],
          "distractor_chunks": [
            {
              "file_path": "src/modules/auth/refresh-token.service.ts",
              "start_line": 8,
              "end_line": 24,
              "reason": "Related to auth but not about token validation specifically"
            }
          ],
          "expected_answer_keywords": ["Bearer", "Authorization header", "verify", "secret", "expiry", "claims"]
        },
        {
          "query_id": "q002",
          "query": "Why was Prisma chosen over raw SQL for database access?",
          "difficulty": "hard",
          "category": "architecture",
          "relevant_chunks": [
            {
              "file_path": "docs/decisions/003-orm-selection.md",
              "start_line": 1,
              "end_line": 45,
              "relevance": 3,
              "explanation": "Architecture Decision Record explaining ORM choice"
            },
            {
              "file_path": "src/modules/projects/repository.ts",
              "start_line": 1,
              "end_line": 32,
              "relevance": 1,
              "explanation": "Repository pattern implementation using Prisma"
            }
          ],
          "distractor_chunks": [
            {
              "file_path": "prisma/schema.prisma",
              "start_line": 1,
              "end_line": 100,
              "reason": "Schema definition — related but doesn't explain the 'why'"
            }
          ],
          "expected_answer_keywords": ["type safety", "migration", "query builder", "developer experience", "trade-off"]
        }
      ]
    }
  ]
}
```

**Benchmark size targets:**

| Repository Type | Queries | Difficulty Mix |
|---|---|---|
| Small (< 5K LOC) | 50 | 60% easy, 30% medium, 10% hard |
| Medium (5K–50K LOC) | 100 | 40% easy, 40% medium, 20% hard |
| Large (> 50K LOC) | 150 | 30% easy, 40% medium, 30% hard |
| **Total** | **300+** | **Balanced** |

**Query categories:**
- Architectural (25%): "How is the system structured?"
- Module-specific (25%): "How does the auth module work?"
- Data flow (15%): "What happens when a user logs in?"
- Error handling (15%): "How does the system handle database failures?"
- Trade-offs (10%): "Why X instead of Y?"
- Edge cases (10%): "What happens under concurrent access?"

---

## 3. Layer 2 — Generation Quality

### 3.1 Metrics

#### Faithfulness

Does the generated answer contain only claims that are supported by the retrieved code chunks?

```
Faithfulness = |{claims supported by retrieved context}| / |{total claims in answer}|
```

| Score | Label | Description |
|---|---|---|
| 1.0 | Perfect | Every claim is grounded in code |
| 0.8–0.99 | Good | Minor unsupported claims (e.g., generalized statements) |
| 0.6–0.79 | Acceptable | Some unsupported inferences |
| < 0.6 | Poor | Significant hallucination or unsupported claims |

**Target:** ≥ 0.90 (average across all queries)

**Measurement method:**
1. Generate answer for each benchmark query
2. Extract individual claims from the answer (LLM-assisted decomposition)
3. For each claim, verify it against the retrieved context
4. Compute the ratio

```python
def evaluate_faithfulness(answer: str, context: list[str]) -> float:
    """
    Step 1: Decompose answer into atomic claims
    Step 2: For each claim, check if context supports it
    Step 3: Return ratio of supported claims
    """
    claims = decompose_into_claims(answer)
    supported = 0
    for claim in claims:
        if is_claim_supported(claim, context):
            supported += 1
    return supported / len(claims) if claims else 1.0
```

#### Relevance

Does the answer actually address the user's question?

| Score | Label | Description |
|---|---|---|
| 4 | Perfectly Relevant | Directly and completely answers the question |
| 3 | Mostly Relevant | Answers the core question with minor tangents |
| 2 | Partially Relevant | Addresses related topics but misses the core |
| 1 | Irrelevant | Does not address the question at all |

**Target:** Average score ≥ 3.5

**Measurement method:** LLM-as-judge with pairwise comparison against reference answers.

#### Completeness

Does the answer cover all important aspects of the question?

| Score | Label | Description |
|---|---|---|
| 4 | Complete | Covers all key aspects a thorough answer would include |
| 3 | Mostly Complete | Covers major aspects, minor omissions |
| 2 | Partial | Covers some aspects, notable gaps |
| 1 | Incomplete | Covers very few aspects |

**Target:** Average score ≥ 3.2

#### Clarity

Is the answer well-structured, easy to follow, and appropriately detailed?

| Score | Label | Description |
|---|---|---|
| 4 | Excellent | Clear structure, appropriate detail, no ambiguity |
| 3 | Good | Mostly clear, minor structural issues |
| 2 | Adequate | Understandable but could be better organized |
| 1 | Poor | Confusing, poorly structured, or too verbose/terse |

**Target:** Average score ≥ 3.5

### 3.2 LLM-as-Judge Protocol

Use a strong LLM (GPT-4o or Claude 3.5 Sonnet) as an automated judge for generation quality. To reduce bias:

1. **Pairwise comparison** — Present two answers (from different configurations) in randomized order and ask which is better
2. **Reference anchoring** — Compare against human-written reference answers when available
3. **Multiple judges** — Use 3 different LLM prompts and average the scores
4. **Calibration** — Periodically validate LLM-judge scores against human ratings to ensure alignment

**Judge prompt template:**

```
You are an expert technical evaluator assessing the quality of an interview
preparation answer about a codebase.

QUERY: {user_query}

RETRIEVED CONTEXT:
{context_chunks}

GENERATED ANSWER:
{generated_answer}

REFERENCE ANSWER (if available):
{reference_answer}

Evaluate the generated answer on these dimensions:
1. FAITHFULNESS (0.0-1.0): What fraction of claims in the answer are
   supported by the retrieved context? Unsupported claims are hallucinations.
2. RELEVANCE (1-4): How directly does the answer address the query?
3. COMPLETENESS (1-4): How thoroughly does the answer cover the topic?
4. CLARITY (1-4): How well-structured and clear is the answer?

For each dimension, provide:
- A score
- A brief justification (1-2 sentences)
- For faithfulness, list any unsupported claims you identified

Respond in JSON format:
{
  "faithfulness": {"score": 0.0, "justification": "..."},
  "relevance": {"score": 0, "justification": "..."},
  "completeness": {"score": 0, "justification": "..."},
  "clarity": {"score": 0, "justification": "..."},
  "unsupported_claims": ["claim1", "claim2"]
}
```

---

## 4. Layer 3 — Citation Accuracy

### 4.1 Metrics

#### Citation Precision

Of all citations provided in the answer, what fraction actually support the associated claim?

```
Citation Precision = |{citations that support their claim}| / |{total citations}|
```

**Target:** ≥ 0.95

**Why strict:** A citation that points to the wrong file or line is worse than no citation — it actively misleads the candidate.

#### Citation Recall

Of all claims that *could* be supported by code, what fraction have a citation?

```
Citation Recall = |{claims with valid citations}| / |{claims that could cite code}|
```

**Target:** ≥ 0.80

**Why lower threshold:** Some claims (e.g., "this follows industry best practices") are legitimately uncitable.

#### Citation Localization Accuracy

When a citation references a specific file and line range, is the referenced code actually relevant?

```
Localization Accuracy = |{citations pointing to relevant code}| / |{total line-level citations}|
```

**Target:** ≥ 0.90

**Measurement:** For each citation, verify that the referenced code segment is semantically related to the claim it supports. Use a cosine similarity threshold (≥ 0.7) between the claim embedding and the cited code embedding.

#### Hallucination Rate

The fraction of answers that contain fabricated code references (files or functions that don't exist).

```
Hallucination Rate = |{answers with fabricated references}| / |{total answers}|
```

**Target:** 0.0 (zero tolerance)

**Measurement:** For every file path and function name mentioned in an answer, verify it exists in the repository's symbol table.

### 4.2 Citation Verification Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                 CITATION VERIFICATION PIPELINE               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: EXTRACT citations from generated answer            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Parse answer for:                                   │   │
│  │  • File path references (src/auth/service.ts:15-30) │   │
│  │  • Function/class names (AuthService, JwtGuard)     │   │
│  │  • Inline code blocks                                │   │
│  │  • Linked references to artifacts                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  Step 2: VERIFY existence                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  For each citation:                                  │   │
│  │  • Does the file path exist in the repo?            │   │
│  │  • Does the line range fall within the file?         │   │
│  │  • Does the function/class name exist at that loc?   │   │
│  │                                                      │   │
│  │  Flag: FABRICATION if any check fails                │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  Step 3: VERIFY relevance                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  For each citation:                                  │   │
│  │  • Extract the claim the citation supports          │   │
│  │  • Extract the cited code content                   │   │
│  │  • Compute semantic similarity (embedding cosine)    │   │
│  │                                                      │   │
│  │  Flag: IRRELEVANT if similarity < 0.6               │   │
│  │  Flag: WEAK if similarity 0.6–0.75                  │   │
│  │  Flag: STRONG if similarity > 0.75                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  Step 4: VERIFY line-range accuracy                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  For each line-level citation:                       │   │
│  │  • Does the cited function span the given lines?    │   │
│  │  • Are the most relevant lines within the range?    │   │
│  │                                                      │   │
│  │  Flag: MISALIGNED if the function is at different   │   │
│  │        lines than cited                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Output: Citation quality report per answer                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Layer 4 — End-to-End Experience

### 5.1 Interview Readiness Score (IRS)

A composite score measuring how well the platform prepares a candidate for an interview about their codebase.

```
IRS = w1 × RetrievalQuality + w2 × AnswerQuality + w3 × CitationQuality
    + w4 × CoverageScore + w5 × PracticeScore
```

| Component | Weight | Measurement |
|---|---|---|
| Retrieval Quality | 0.20 | Average Precision@5 across benchmark |
| Answer Quality | 0.30 | Average faithfulness × relevance × completeness |
| Citation Quality | 0.20 | Citation precision × localization accuracy |
| Coverage Score | 0.15 | Fraction of modules with ≥1 question generated |
| Practice Score | 0.15 | Mock interview completion rate × average score |

**Scale:** 0–100

| Score | Label | Description |
|---|---|---|
| 90–100 | Excellent | Candidate would likely pass the interview |
| 75–89 | Good | Solid preparation with minor gaps |
| 60–74 | Adequate | Basic preparation, some areas need work |
| 40–59 | Insufficient | Significant gaps in preparation |
| 0–39 | Poor | Platform failed to provide useful preparation |

**Target:** Average IRS ≥ 75 across all analyzed repositories.

### 5.2 Human Evaluation Protocol

Automated metrics are necessary but insufficient. Human evaluation validates that the platform produces answers that real candidates and interviewers find useful.

#### Evaluation Panel

| Role | Count | Purpose |
|---|---|---|
| Software engineers (3–7 years) | 5 | Simulate real interviewers |
| Bootcamp graduates | 5 | Represent target users |
| CS students | 5 | Represent target users |
| Technical interviewers (hiring managers) | 3 | Expert assessment |

#### Evaluation Tasks

**Task 1: Answer Quality Rating**
- Present 30 generated Q&A pairs (randomly sampled from benchmark)
- Each evaluator rates on a 1–5 scale for: helpfulness, accuracy, interview-readiness
- Inter-annotator agreement measured via Krippendorff's alpha (target: ≥ 0.70)

**Task 2: Mock Interview Simulation**
- Have 5 candidates complete full mock interview sessions
- Record their feedback on each question's relevance and difficulty
- Compare their self-assessed preparedness before and after

**Task 3: Comparison with Manual Preparation**
- Ask 5 engineers to manually prepare interview answers for their own repos
- Compare their answers to Vibe Coder's generated answers
- Measure: time saved, coverage of topics, accuracy of technical details

**Task 4: Citation Trust Assessment**
- Present answers with citations to 5 engineers
- Ask them to verify 10 citations each (check if citations are accurate)
- Measure: trust score (how many citations they confirm as accurate)

#### Evaluation Schedule

| Frequency | Activity | Participants |
|---|---|---|
| Weekly (automated) | Run full benchmark suite | System |
| Bi-weekly (automated) | Citation verification pipeline | System |
| Monthly | Human evaluation session | 5 evaluators, 30 Q&A pairs |
| Quarterly | Full user study | 15 participants, mock interviews |
| Per release | Regression check against previous version | System + 2 human evaluators |

---

## 6. Layer 5 — System Performance

### 6.1 Latency Targets

| Operation | P50 Target | P95 Target | P99 Target |
|---|---|---|---|
| Retrieval (dense + sparse + fusion) | 80ms | 200ms | 400ms |
| Retrieval + reranking | 150ms | 350ms | 700ms |
| Chat response (first token) | 800ms | 2000ms | 4000ms |
| Chat response (streaming complete) | 3000ms | 8000ms | 15000ms |
| Mock interview question generation | 2000ms | 5000ms | 10000ms |
| Full repository analysis | 120s | 300s | 600s |
| Architecture overview generation | 15s | 40s | 80s |
| Question bank generation (45 questions) | 30s | 60s | 120s |

### 6.2 Throughput Targets

| Metric | Target |
|---|---|
| Concurrent chat sessions | 500 |
| Concurrent mock interviews | 100 |
| Analysis jobs processed per hour | 60 |
| API requests per second (aggregate) | 1000 |
| WebSocket connections (concurrent) | 2000 |

### 6.3 Error Budget

| Metric | Monthly Budget | Alert Threshold |
|---|---|---|
| Availability | 99.9% (43 min downtime) | < 99.95% rolling 24h |
| API error rate (5xx) | < 0.1% of requests | > 0.5% in 5 min window |
| Analysis failure rate | < 2% of jobs | > 5% in 1 hour |
| Chat timeout rate | < 1% of messages | > 3% in 1 hour |
| Citation hallucination rate | 0% (zero tolerance) | Any occurrence |

### 6.4 Cost Per Query

| Component | Target Cost | Budget |
|---|---|---|
| Embedding generation | $0.0001 | Per query |
| Dense retrieval (Pinecone) | $0.00001 | Per query |
| Sparse retrieval (OpenSearch) | $0.00005 | Per query |
| Cross-encoder reranking | $0.0002 | Per query |
| LLM generation (GPT-4o) | $0.008 | Per chat message |
| LLM generation (GPT-4o-mini) | $0.0003 | Per classification/routing |
| **Total per chat interaction** | **~$0.009** | — |
| **Total per full analysis** | **~$1.50** | — |

---

## 7. Evaluation Infrastructure

### 7.1 Automated Benchmark Pipeline

```python
# eval/run_benchmark.py

import json
from dataclasses import dataclass
from typing import List, Dict
from pathlib import Path

@dataclass
class BenchmarkQuery:
    query_id: str
    query: str
    relevant_chunks: List[Dict]
    distractor_chunks: List[Dict]
    expected_keywords: List[str]
    difficulty: str
    category: str

@dataclass
class RetrievalResult:
    chunk_id: str
    file_path: str
    start_line: int
    end_line: int
    score: float
    rank: int

@dataclass
class GenerationResult:
    answer: str
    citations: List[Dict]
    tokens_used: int
    latency_ms: int

@dataclass
class EvaluationResult:
    query_id: str
    # Retrieval metrics
    precision_at_3: float
    precision_at_5: float
    recall_at_10: float
    mrr: float
    ndcg_at_5: float
    hit_rate_at_5: bool
    # Generation metrics
    faithfulness: float
    relevance: int
    completeness: int
    clarity: int
    # Citation metrics
    citation_precision: float
    citation_recall: float
    hallucination_detected: bool
    # Performance
    retrieval_latency_ms: int
    generation_latency_ms: int
    total_latency_ms: int
    total_tokens: int


class EvaluationPipeline:
    def __init__(self, benchmark_path: str, config: dict):
        self.benchmark = self._load_benchmark(benchmark_path)
        self.config = config
        self.results: List[EvaluationResult] = []

    def run_full_evaluation(self) -> Dict:
        """Run all evaluation layers and produce a summary report."""
        print(f"Running evaluation on {len(self.benchmark)} queries...")

        for query in self.benchmark:
            result = self._evaluate_single_query(query)
            self.results.append(result)

        report = self._generate_report()
        self._save_report(report)
        self._check_thresholds(report)
        return report

    def _evaluate_single_query(self, query: BenchmarkQuery) -> EvaluationResult:
        """Evaluate a single query across all layers."""

        # Layer 1: Retrieval
        retrieval_results = self._run_retrieval(query)
        retrieval_metrics = self._compute_retrieval_metrics(
            retrieval_results, query.relevant_chunks
        )

        # Layer 2: Generation
        generation_result = self._run_generation(query, retrieval_results)
        generation_metrics = self._compute_generation_metrics(
            generation_result, query, retrieval_results
        )

        # Layer 3: Citation
        citation_metrics = self._compute_citation_metrics(
            generation_result, query
        )

        # Layer 5: Performance
        performance_metrics = {
            "retrieval_latency_ms": retrieval_results["latency_ms"],
            "generation_latency_ms": generation_result["latency_ms"],
            "total_latency_ms": (
                retrieval_results["latency_ms"] +
                generation_result["latency_ms"]
            ),
            "total_tokens": generation_result["tokens_used"],
        }

        return EvaluationResult(
            query_id=query.query_id,
            **retrieval_metrics,
            **generation_metrics,
            **citation_metrics,
            **performance_metrics,
        )

    def _compute_retrieval_metrics(
        self,
        results: List[RetrievalResult],
        relevant_chunks: List[Dict],
    ) -> Dict:
        """Compute all retrieval quality metrics."""
        relevant_files = {
            (c["file_path"], c["start_line"], c["end_line"])
            for c in relevant_chunks
            if c["relevance"] >= 2
        }

        retrieved_files = [
            (r.file_path, r.start_line, r.end_line)
            for r in results
        ]

        # Precision@K
        def precision_at_k(k):
            top_k = retrieved_files[:k]
            hits = sum(1 for f in top_k if f in relevant_files)
            return hits / k if k > 0 else 0.0

        # Recall@K
        def recall_at_k(k):
            top_k = retrieved_files[:k]
            hits = sum(1 for f in top_k if f in relevant_files)
            return hits / len(relevant_files) if relevant_files else 0.0

        # MRR
        mrr = 0.0
        for i, f in enumerate(retrieved_files):
            if f in relevant_files:
                mrr = 1.0 / (i + 1)
                break

        # NDCG@K
        def ndcg_at_k(k):
            dcg = 0.0
            for i in range(min(k, len(retrieved_files))):
                rel = 1.0 if retrieved_files[i] in relevant_files else 0.0
                dcg += (2**rel - 1) / np.log2(i + 2)
            # Ideal DCG
            ideal_rels = sorted(
                [1.0 if f in relevant_files else 0.0 for f in retrieved_files[:k]],
                reverse=True
            )
            idcg = sum(
                (2**r - 1) / np.log2(i + 2)
                for i, r in enumerate(ideal_rels)
            )
            return dcg / idcg if idcg > 0 else 0.0

        # Hit Rate@K
        hit_rate_5 = any(f in relevant_files for f in retrieved_files[:5])

        return {
            "precision_at_3": precision_at_k(3),
            "precision_at_5": precision_at_k(5),
            "recall_at_10": recall_at_k(10),
            "mrr": mrr,
            "ndcg_at_5": ndcg_at_k(5),
            "hit_rate_at_5": hit_rate_5,
        }

    def _compute_generation_metrics(
        self,
        result: GenerationResult,
        query: BenchmarkQuery,
        retrieval_results: List[RetrievalResult],
    ) -> Dict:
        """Compute generation quality metrics using LLM-as-judge."""
        context = [r.content for r in retrieval_results]

        judge_prompt = JUDGE_PROMPT.format(
            query=query.query,
            context="\n\n".join(context),
            answer=result.answer,
        )

        judgment = self.llm_judge.evaluate(judge_prompt)

        return {
            "faithfulness": judgment["faithfulness"]["score"],
            "relevance": judgment["relevance"]["score"],
            "completeness": judgment["completeness"]["score"],
            "clarity": judgment["clarity"]["score"],
        }

    def _compute_citation_metrics(
        self,
        result: GenerationResult,
        query: BenchmarkQuery,
    ) -> Dict:
        """Compute citation accuracy metrics."""
        total_citations = len(result.citations)
        if total_citations == 0:
            return {
                "citation_precision": 0.0,
                "citation_recall": 0.0,
                "hallucination_detected": False,
            }

        # Verify each citation
        valid_citations = 0
        hallucination = False

        for citation in result.citations:
            # Check existence
            if not self.repo_index.file_exists(citation["file_path"]):
                hallucination = True
                continue

            # Check line range
            if not self.repo_index.lines_valid(
                citation["file_path"],
                citation["start_line"],
                citation["end_line"]
            ):
                hallucination = True
                continue

            # Check relevance
            code_content = self.repo_index.get_lines(
                citation["file_path"],
                citation["start_line"],
                citation["end_line"]
            )
            similarity = self.embedding_service.cosine_similarity(
                citation.get("claim", ""), code_content
            )
            if similarity >= 0.6:
                valid_citations += 1

        citation_precision = valid_citations / total_citations

        # Citation recall (simplified — could use claim decomposition)
        citable_claims = self._count_citable_claims(result.answer)
        citation_recall = valid_citations / citable_claims if citable_claims > 0 else 1.0

        return {
            "citation_precision": citation_precision,
            "citation_recall": min(citation_recall, 1.0),
            "hallucination_detected": hallucination,
        }

    def _generate_report(self) -> Dict:
        """Generate aggregate evaluation report."""
        n = len(self.results)

        return {
            "summary": {
                "total_queries": n,
                "timestamp": datetime.utcnow().isoformat(),
            },
            "retrieval": {
                "precision_at_3_mean": mean(r.precision_at_3 for r in self.results),
                "precision_at_5_mean": mean(r.precision_at_5 for r in self.results),
                "recall_at_10_mean": mean(r.recall_at_10 for r in self.results),
                "mrr_mean": mean(r.mrr for r in self.results),
                "ndcg_at_5_mean": mean(r.ndcg_at_5 for r in self.results),
                "hit_rate_at_5": sum(r.hit_rate_at_5 for r in self.results) / n,
            },
            "generation": {
                "faithfulness_mean": mean(r.faithfulness for r in self.results),
                "relevance_mean": mean(r.relevance for r in self.results),
                "completeness_mean": mean(r.completeness for r in self.results),
                "clarity_mean": mean(r.clarity for r in self.results),
            },
            "citations": {
                "citation_precision_mean": mean(r.citation_precision for r in self.results),
                "citation_recall_mean": mean(r.citation_recall for r in self.results),
                "hallucination_rate": sum(
                    1 for r in self.results if r.hallucination_detected
                ) / n,
            },
            "performance": {
                "retrieval_latency_p50": percentile(
                    [r.retrieval_latency_ms for r in self.results], 50
                ),
                "retrieval_latency_p95": percentile(
                    [r.retrieval_latency_ms for r in self.results], 95
                ),
                "generation_latency_p50": percentile(
                    [r.generation_latency_ms for r in self.results], 50
                ),
                "generation_latency_p95": percentile(
                    [r.generation_latency_ms for r in self.results], 95
                ),
                "total_tokens_mean": mean(r.total_tokens for r in self.results),
            },
            "by_difficulty": self._aggregate_by_difficulty(),
            "by_category": self._aggregate_by_category(),
        }

    def _check_thresholds(self, report: Dict) -> bool:
        """Check if evaluation meets quality thresholds."""
        thresholds = {
            ("retrieval", "precision_at_3_mean"): (0.85, ">="),
            ("retrieval", "precision_at_5_mean"): (0.80, ">="),
            ("retrieval", "recall_at_10_mean"): (0.80, ">="),
            ("retrieval", "mrr_mean"): (0.85, ">="),
            ("retrieval", "ndcg_at_5_mean"): (0.80, ">="),
            ("retrieval", "hit_rate_at_5"): (0.90, ">="),
            ("generation", "faithfulness_mean"): (0.90, ">="),
            ("generation", "relevance_mean"): (3.5, ">="),
            ("generation", "completeness_mean"): (3.2, ">="),
            ("generation", "clarity_mean"): (3.5, ">="),
            ("citations", "citation_precision_mean"): (0.95, ">="),
            ("citations", "hallucination_rate"): (0.0, "=="),
        }

        all_passed = True
        failures = []

        for (section, metric), (threshold, op) in thresholds.items():
            actual = report[section][metric]
            passed = (
                actual >= threshold if op == ">="
                else actual == threshold if op == "=="
                else actual <= threshold
            )
            if not passed:
                all_passed = False
                failures.append(
                    f"FAIL: {section}.{metric} = {actual:.4f} "
                    f"(threshold: {op} {threshold})"
                )

        if failures:
            print("\n⚠️  THRESHOLD FAILURES:")
            for f in failures:
                print(f"  {f}")
        else:
            print("\n✅ All quality thresholds passed!")

        return all_passed
```

### 7.2 CI/CD Integration

```yaml
# .github/workflows/eval.yml
name: Quality Evaluation

on:
  schedule:
    - cron: "0 2 * * 1"  # Weekly on Monday at 2 AM
  pull_request:
    paths:
      - "packages/retrieval/**"
      - "packages/ast-parser/**"
      - "apps/worker/**"
      - "apps/mock-interview/**"
  workflow_dispatch:

jobs:
  evaluation:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          pip install -r eval/requirements.txt

      - name: Download benchmark dataset
        run: |
          aws s3 cp s3://vibecoder-eval/benchmarks/ eval/benchmarks/ --recursive

      - name: Run retrieval evaluation
        run: |
          python eval/run_benchmark.py \
            --benchmark eval/benchmarks/ret_bench_v1.json \
            --config eval/configs/${{ github.event_name == 'pull_request' && 'pr' || 'full' }}.yaml \
            --output eval/results/

      - name: Check quality thresholds
        run: |
          python eval/check_thresholds.py \
            --results eval/results/summary.json \
            --thresholds eval/configs/thresholds.yaml

      - name: Upload results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: eval-results-${{ github.sha }}
          path: eval/results/

      - name: Comment on PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('eval/results/summary.json'));
            const body = `## 🧪 Quality Evaluation Results

            | Metric | Score | Threshold | Status |
            |--------|-------|-----------|--------|
            | Precision@3 | ${results.retrieval.precision_at_3_mean.toFixed(3)} | ≥ 0.85 | ${results.retrieval.precision_at_3_mean >= 0.85 ? '✅' : '❌'} |
            | MRR | ${results.retrieval.mrr_mean.toFixed(3)} | ≥ 0.85 | ${results.retrieval.mrr_mean >= 0.85 ? '✅' : '❌'} |
            | Faithfulness | ${results.generation.faithfulness_mean.toFixed(3)} | ≥ 0.90 | ${results.generation.faithfulness_mean >= 0.90 ? '✅' : '❌'} |
            | Citation Precision | ${results.citations.citation_precision_mean.toFixed(3)} | ≥ 0.95 | ${results.citations.citation_precision_mean >= 0.95 ? '✅' : '❌'} |
            | Hallucination Rate | ${results.citations.hallucination_rate.toFixed(3)} | 0.0 | ${results.citations.hallucination_rate === 0.0 ? '✅' : '❌'} |

            *Full report uploaded as artifact.*`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

      - name: Fail if thresholds exceeded
        if: github.event_name == 'pull_request'
        run: |
          python eval/check_thresholds.py \
            --results eval/results/summary.json \
            --thresholds eval/configs/thresholds.yaml \
            --fail-on-regression
```

### 7.3 Continuous Monitoring Dashboard

```python
# eval/monitoring/dashboard_config.py

DASHBOARD_CONFIG = {
    "title": "Vibe Coder Quality Dashboard",
    "refresh_interval": "5m",
    "panels": [
        {
            "title": "Retrieval Quality (7-day rolling)",
            "type": "timeseries",
            "metrics": [
                "retrieval.precision_at_3",
                "retrieval.precision_at_5",
                "retrieval.mrr",
                "retrieval.ndcg_at_5",
            ],
            "thresholds": {
                "precision_at_3": 0.85,
                "mrr": 0.85,
            },
        },
        {
            "title": "Generation Quality (7-day rolling)",
            "type": "timeseries",
            "metrics": [
                "generation.faithfulness",
                "generation.relevance",
                "generation.completeness",
                "generation.clarity",
            ],
            "thresholds": {
                "faithfulness": 0.90,
                "relevance": 3.5,
            },
        },
        {
            "title": "Citation Health",
            "type": "timeseries",
            "metrics": [
                "citations.citation_precision",
                "citations.citation_recall",
                "citations.hallucination_rate",
            ],
            "thresholds": {
                "citation_precision": 0.95,
                "hallucination_rate": 0.0,
            },
            "alert_on": {
                "hallucination_rate": "> 0",
            },
        },
        {
            "title": "Latency Distribution",
            "type": "heatmap",
            "metrics": [
                "performance.retrieval_latency",
                "performance.generation_latency_first_token",
                "performance.generation_latency_complete",
            ],
        },
        {
            "title": "Quality by Repository Size",
            "type": "barchart",
            "group_by": "repo_size_bucket",
            "metrics": ["retrieval.precision_at_5", "generation.faithfulness"],
        },
        {
            "title": "Quality by Query Category",
            "type": "barchart",
            "group_by": "query_category",
            "metrics": ["retrieval.mrr", "generation.completeness"],
        },
        {
            "title": "Cost per Interaction",
            "type": "timeseries",
            "metrics": [
                "cost.retrieval_per_query",
                "cost.generation_per_message",
                "cost.total_per_analysis",
            ],
        },
        {
            "title": "Error Rate",
            "type": "timeseries",
            "metrics": [
                "system.api_error_rate",
                "system.analysis_failure_rate",
                "system.chat_timeout_rate",
            ],
            "thresholds": {
                "api_error_rate": 0.001,
                "analysis_failure_rate": 0.02,
            },
        },
    ],
}
```

---

## 8. Evaluation by Scenario

### 8.1 Scenario Matrix

| Scenario | Query Type | Difficulty | Key Metrics to Watch |
|---|---|---|---|
| **New user, first analysis** | Architecture overview | Easy | Precision@5, Faithfulness |
| **Deep module dive** | Module-specific | Medium | Recall@10, Completeness |
| **Adversarial interview prep** | Trade-offs, "why not X?" | Hard | Faithfulness, Citation Precision |
| **Multi-module question** | Cross-cutting concern | Hard | Recall@10, NDCG@5 |
| **Debugging scenario** | "How would you fix X?" | Medium | Relevance, Completeness |
| **Large repository** | Any | Any | Latency, Recall@20 |
| **Non-English codebase** | Any | Any | Retrieval quality, Faithfulness |
| **Monorepo with configs** | Config-heavy | Medium | Citation Accuracy, Localization |

### 8.2 Stress Testing

| Test | Condition | Expected Behavior |
|---|---|---|
| **Repo size stress** | 100K+ LOC repository | Latency scales sub-linearly, quality maintained |
| **Query ambiguity** | Vague query: "Tell me about the code" | System asks clarifying question or gives broad overview |
| **Adversarial query** | "This code has a security vulnerability, right?" | System does not confirm unverified claims; cites actual security code |
| **Rapid-fire queries** | 20 queries in 60 seconds | Rate limiting activates, quality doesn't degrade |
| **Concurrent users** | 100 simultaneous chat sessions | Response times stay within P95 targets |

---

## 9. Benchmark Dataset Management

### 9.1 Dataset Structure

```
eval/
├── benchmarks/
│   ├── ret_bench_v1.json              # Retrieval benchmark
│   ├── gen_bench_v1.json              # Generation benchmark
│   ├── citation_bench_v1.json         # Citation verification benchmark
│   ├── mock_interview_bench_v1.json   # Mock interview benchmark
│   └── repos/                         # Reference repositories for benchmark
│       ├── portfolio-api/             # Small TypeScript project
│       ├── react-dashboard/           # Medium React project
│       ├── microservices-go/          # Large Go microservices
│       └── ml-pipeline-python/        # Python ML project
├── configs/
│   ├── full.yaml                      # Full evaluation config
│   ├── pr.yaml                        # PR check config (subset)
│   └── thresholds.yaml                # Quality thresholds
├── results/                           # Evaluation results (gitignored)
├── run_benchmark.py                   # Main evaluation runner
├── check_thresholds.py                # Threshold checker
├── generate_report.py                 # Report generator
└── requirements.txt                   # Python dependencies
```

### 9.2 Dataset Versioning

```yaml
# eval/benchmarks/metadata.yaml
dataset_version: "1.2.0"
created_at: "2025-09-19"
last_updated: "2025-09-19"
changelog:
  - version: "1.2.0"
    date: "2025-09-19"
    changes:
      - "Added 50 queries for monorepo scenarios"
      - "Updated relevance labels based on human evaluation"
  - version: "1.1.0"
    date: "2025-09-12"
    changes:
      - "Added citation verification benchmark"
      - "Expanded Go and Python repositories"
  - version: "1.0.0"
    date: "2025-09-01"
    changes:
      - "Initial benchmark with 200 queries across 4 repositories"

repositories:
  - name: "portfolio-api"
    language: "TypeScript"
    loc: 28400
    query_count: 50
    difficulty_distribution: { easy: 25, medium: 15, hard: 10 }

  - name: "react-dashboard"
    language: "TypeScript"
    loc: 11200
    query_count: 50
    difficulty_distribution: { easy: 20, medium: 20, hard: 10 }

  - name: "microservices-go"
    language: "Go"
    loc: 67000
    query_count: 75
    difficulty_distribution: { easy: 20, medium: 30, hard: 25 }

  - name: "ml-pipeline-python"
    language: "Python"
    loc: 35000
    query_count: 50
    difficulty_distribution: { easy: 15, medium: 20, hard: 15 }
```

### 9.3 Contribution Guidelines

When adding new benchmark queries:

1. **Source the query from real user behavior** — Use actual chat logs (anonymized) or interview question databases
2. **Label ground truth carefully** — At least 2 annotators must agree on relevant chunks
3. **Include distractors** — Add code that is *related* but not *relevant* to test precision
4. **Cover edge cases** — Include queries that are vague, ambiguous, or require multi-hop reasoning
5. **Version the dataset** — Never modify existing entries; add new versions instead

---

## 10. Evaluation Cadence & Governance

### 10.1 Evaluation Schedule

| Cadence | Activity | Scope | Owner |
|---|---|---|---|
| Per PR | Retrieval + citation check (subset) | 50 queries | CI pipeline |
| Daily | Full automated benchmark | All 300+ queries | Scheduled job |
| Weekly | Cost and latency analysis | System metrics | Engineering |
| Bi-weekly | Human evaluation session | 30 Q&A pairs | QA team |
| Monthly | Model comparison (A/B test analysis) | Full benchmark | ML team |
| Quarterly | User study with real candidates | 15 participants | Product team |
| Per release | Regression comparison | Full benchmark vs. baseline | Release manager |

### 10.2 Escalation Protocol

```
┌─────────────────────────────────────────────────────────────┐
│                 QUALITY ESCALATION PROTOCOL                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  SEVERITY 1 — Critical (Immediate Action)                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Triggers:                                           │   │
│  │  • Hallucination rate > 0                            │   │
│  │  • Faithfulness drops below 0.70                     │   │
│  │  • Citation precision drops below 0.80               │   │
│  │                                                      │   │
│  │  Action:                                             │   │
│  │  1. Halt deployment pipeline                         │   │
│  │  2. Page on-call engineer                            │   │
│  │  3. Roll back to last known-good version            │   │
│  │  4. Root cause analysis within 4 hours              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  SEVERITY 2 — High (Within 24 Hours)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Triggers:                                           │   │
│  │  • Precision@3 drops below 0.75                      │   │
│  │  • MRR drops below 0.75                              │   │
│  │  • Latency P95 exceeds 2x target                     │   │
│  │  • Analysis failure rate > 5%                        │   │
│  │                                                      │   │
│  │  Action:                                             │   │
│  │  1. Create incident ticket                           │   │
│  │  2. Investigate root cause                           │   │
│  │  3. Implement fix or workaround                      │   │
│  │  4. Verify fix against benchmark                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  SEVERITY 3 — Medium (Within 1 Week)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Triggers:                                           │   │
│  │  • Any metric below threshold by < 10%               │   │
│  │  • Cost per query increases by > 20%                  │   │
│  │  • Human evaluator satisfaction drops                 │   │
│  │                                                      │   │
│  │  Action:                                             │   │
│  │  1. Add to sprint backlog                            │   │
│  │  2. Investigate during next sprint                   │   │
│  │  3. Implement improvement                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 A/B Testing Framework

For comparing different retrieval strategies, models, or prompt templates:

```python
# eval/ab_testing.py

@dataclass
class ABTestConfig:
    test_name: str
    variant_a: Dict  # e.g., {"retrieval": "dense_only", "model": "gpt-4o"}
    variant_b: Dict  # e.g., {"retrieval": "hybrid_rrf", "model": "gpt-4o"}
    sample_size: int = 100
    confidence_level: float = 0.95
    primary_metric: str = "retrieval.precision_at_5"
    secondary_metrics: List[str] = None

class ABTestRunner:
    def __init__(self, config: ABTestConfig, benchmark: List[BenchmarkQuery]):
        self.config = config
        self.benchmark = benchmark
        self.results_a = []
        self.results_b = []

    def run(self) -> Dict:
        """Run A/B test and return statistical comparison."""
        # Split benchmark randomly
        queries_a, queries_b = self._split_benchmark()

        # Run both variants
        self.results_a = self._run_variant(queries_a, self.config.variant_a)
        self.results_b = self._run_variant(queries_b, self.config.variant_b)

        # Statistical comparison
        comparison = self._compare_variants()

        return {
            "test_name": self.config.test_name,
            "variant_a": self.config.variant_a,
            "variant_b": self.config.variant_b,
            "sample_size": len(queries_a),
            "results": comparison,
            "recommendation": self._make_recommendation(comparison),
        }

    def _compare_variants(self) -> Dict:
        """Compare variants using statistical tests."""
        from scipy import stats

        metrics_to_compare = [self.config.primary_metric] + (
            self.config.secondary_metrics or []
        )

        comparison = {}
        for metric in metrics_to_compare:
            values_a = [getattr(r, metric) for r in self.results_a]
            values_b = [getattr(r, metric) for r in self.results_b]

            # Mann-Whitney U test (non-parametric)
            u_stat, p_value = stats.mannwhitneyu(
                values_a, values_b, alternative='two-sided'
            )

            # Effect size (Cohen's d)
            pooled_std = np.sqrt(
                (np.std(values_a)**2 + np.std(values_b)**2) / 2
            )
            cohens_d = (np.mean(values_b) - np.mean(values_a)) / pooled_std if pooled_std > 0 else 0

            comparison[metric] = {
                "variant_a_mean": np.mean(values_a),
                "variant_b_mean": np.mean(values_b),
                "difference": np.mean(values_b) - np.mean(values_a),
                "p_value": p_value,
                "significant": p_value < (1 - self.config.confidence_level),
                "effect_size": cohens_d,
                "effect_interpretation": self._interpret_effect(cohens_d),
            }

        return comparison

    def _interpret_effect(self, d: float) -> str:
        """Interpret Cohen's d effect size."""
        d = abs(d)
        if d < 0.2:
            return "negligible"
        elif d < 0.5:
            return "small"
        elif d < 0.8:
            return "medium"
        else:
            return "large"

    def _make_recommendation(self, comparison: Dict) -> str:
        """Make a recommendation based on statistical results."""
        primary = comparison[self.config.primary_metric]

        if primary["significant"] and primary["difference"] > 0:
            return (
                f"RECOMMEND VARIANT B: {self.config.primary_metric} improved by "
                f"{primary['difference']:.4f} (p={primary['p_value']:.4f}, "
                f"effect size: {primary['effect_interpretation']}). "
                f"Variant B shows statistically significant improvement."
            )
        elif primary["significant"] and primary["difference"] < 0:
            return (
                f"RECOMMEND VARIANT A: {self.config.primary_metric} decreased by "
                f"{abs(primary['difference']):.4f} (p={primary['p_value']:.4f}). "
                f"Variant B shows statistically significant regression."
            )
        else:
            return (
                f"NO SIGNIFICANT DIFFERENCE: {self.config.primary_metric} shows "
                f"no statistically significant change (p={primary['p_value']:.4f}). "
                f"Consider secondary metrics and cost for decision."
            )
```

---

## 11. Summary — Quality Thresholds

| Layer | Metric | Threshold | Severity if Breached |
|---|---|---|---|
| **Retrieval** | Precision@3 | ≥ 0.85 | High |
| **Retrieval** | Precision@5 | ≥ 0.80 | High |
| **Retrieval** | Recall@10 | ≥ 0.80 | Medium |
| **Retrieval** | MRR | ≥ 0.85 | High |
| **Retrieval** | NDCG@5 | ≥ 0.80 | Medium |
| **Retrieval** | Hit Rate@5 | ≥ 0.90 | Critical |
| **Generation** | Faithfulness | ≥ 0.90 | Critical |
| **Generation** | Relevance | ≥ 3.5 / 4 | High |
| **Generation** | Completeness | ≥ 3.2 / 4 | Medium |
| **Generation** | Clarity | ≥ 3.5 / 4 | Medium |
| **Citations** | Citation Precision | ≥ 0.95 | Critical |
| **Citations** | Citation Recall | ≥ 0.80 | Medium |
| **Citations** | Hallucination Rate | == 0.0 | **Blocker** |
| **Performance** | Retrieval P95 | ≤ 200ms | Medium |
| **Performance** | First Token P95 | ≤ 2000ms | High |
| **Performance** | Streaming Complete P95 | ≤ 8000ms | Medium |
| **Performance** | API Error Rate | ≤ 0.1% | Critical |
| **Cost** | Per Chat Message | ≤ $0.01 | Medium |
| **Cost** | Per Full Analysis | ≤ $2.00 | Medium |

---

*This evaluation framework ensures that Vibe Coder maintains consistently high quality across all dimensions — from retrieving the right code to generating accurate, citation-grounded answers that candidates can trust in interview preparation.*
