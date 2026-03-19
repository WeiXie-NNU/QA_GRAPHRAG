# GraphRAG Best-Practice Roadmap

## Goal

Evolve this repository from a working prototype into a stable, testable, and observable GraphRAG application with:

- one canonical knowledge-repository layout
- one primary retrieval path
- grounded evidence flow from retrieval to answer
- clear separation between orchestration, retrieval, storage, and UI
- repeatable validation for both code and knowledge graph artifacts

## Current Gaps

The current codebase already has useful building blocks, but it still behaves like a prototype in a few critical places:

- the GraphRAG runtime dependency is declared but not reliably available at runtime
- the repository layout does not consistently contain the full GraphRAG artifact set
- local/global retrieval can degrade into fallback logic without strong visibility
- recommendation synthesis is not fully grounded on structured evidence
- multiple retrieval approaches coexist without a clear primary/secondary contract
- secrets and environment handling are not production-safe

## Target Architecture

Recommended backend shape:

- `agent/workflows/`
  - LangGraph workflow definitions only
- `agent/retrieval/`
  - GraphRAG query engine, repository discovery, evidence normalization
- `agent/storage/`
  - thread persistence, query-result persistence, schema migrations
- `agent/services/`
  - use-case services that orchestrate retrieval and domain logic
- `agent/evals/`
  - benchmark sets, regression scripts, scoring helpers
- `agent/api/`
  - FastAPI route registration
- `resources/repositories/<MODEL>/kg/`
  - canonical GraphRAG index artifacts only
- `experiments/`
  - Neo4j/FAISS/manual retrieval experiments, not part of the main serving path

Recommended data flow:

1. User query enters LangGraph workflow.
2. Workflow extracts intent and domain entities.
3. Retrieval planner selects `kg_id`, query rewrite, and search strategy.
4. GraphRAG retrieval returns structured evidence.
5. Synthesis uses only normalized evidence, not raw tool text blobs.
6. Quality gate validates grounding, units, ranges, and answer completeness.
7. Final answer and retrieval trace are persisted.

## Phase 0: Stabilize Runtime and Artifacts

Objective: make GraphRAG reliably runnable before changing architecture.

### Tasks

- Remove hardcoded credentials from [config.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/config.py).
- Add a startup verification script:
  - `scripts/verify_runtime.py`
  - checks `graphrag`, `langgraph`, `pyarrow`, and repository readability
- Add a knowledge graph verification script:
  - `scripts/verify_kg.py --kg prosail`
  - `scripts/verify_kg.py --kg lue`
- Define the required artifact set for every KG:
  - `settings.yaml`
  - `output/entities.parquet`
  - `output/relationships.parquet`
  - `output/communities.parquet`
  - `output/text_units.parquet`
  - `output/community_reports.parquet`
  - `output/lancedb/`
- Fail fast at app startup if a configured KG is incomplete.
- Mark unavailable KGs as disabled instead of allowing silent runtime degradation.

### Files to touch first

- [pyproject.toml](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/pyproject.toml)
- [agent/config.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/config.py)
- [agent/test_agent/repository_registry.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/repository_registry.py)
- [agent/demo.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/demo.py)

### Acceptance Criteria

- `python scripts/verify_runtime.py` passes on a fresh machine.
- `python scripts/verify_kg.py --kg prosail` reports complete artifacts.
- server startup clearly reports which KGs are available and why.
- no secret is stored in source code.

## Phase 1: Consolidate Retrieval

Objective: make GraphRAG the primary retrieval backend with an explicit fallback policy.

### Tasks

- Move GraphRAG retrieval code into `agent/retrieval/graphrag_retriever.py`.
- Keep one primary retrieval interface:
  - `retrieve_local(query, kg_id, ...)`
  - `retrieve_global(query, kg_id, ...)`
  - `retrieve(query, strategy, kg_id, ...)`
- Normalize all retrieval output into a single evidence schema:
  - `query`
  - `kg_id`
  - `search_type`
  - `entities`
  - `relationships`
  - `communities`
  - `text_units`
  - `source_documents`
  - `latency_ms`
  - `raw_response`
- Downgrade `chunk_retriever.py` and `vectorstore.py` to optional experiments unless they are promoted to formal fallback backends.
- If fallback remains:
  - emit `retrieval_backend = graphrag|fallback_keyword|experimental`
  - persist that backend in result storage

### Files to refactor

- [agent/test_agent/graphrag_query.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/graphrag_query.py)
- [agent/chunk_retriever.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/chunk_retriever.py)
- [agent/vectorstore.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/vectorstore.py)
- [agent/test_agent/agent.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/agent.py)

### Acceptance Criteria

- the main agent path uses one retrieval abstraction
- every answer can tell which retrieval backend served it
- fallback behavior is explicit and observable, not silent

## Phase 2: Ground the Agent on Structured Evidence

Objective: prevent the workflow from turning retrieval into unstructured text and then guessing.

### Tasks

- Replace tool output payloads that mostly contain truncated response text with structured evidence payloads.
- In synthesis, consume:
  - normalized entity list
  - relationship list
  - text-unit ids
  - source document ids
  - short evidence summaries
- Keep free-form textual summaries as a view layer artifact, not as the source of truth.
- Add evidence-to-answer linking:
  - each recommendation contains `evidence_ids`
  - each recommendation contains `confidence`
  - each recommendation contains `uncertainty`
- Add domain validation before final answer:
  - parameter allowed for current model
  - unit matches expected unit
  - numeric value or value range is plausible

### Files to refactor

- [agent/test_agent/agent.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/agent.py)
- [agent/test_agent/state.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/state.py)
- [agent/test_agent/graphrag_storage.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/graphrag_storage.py)

### Acceptance Criteria

- every recommendation includes traceable evidence ids
- quality check fails if evidence coverage is missing
- final answers remain readable while retaining traceability

## Phase 3: Simplify Workflow Boundaries

Objective: make the LangGraph workflow easier to reason about and test.

### Recommended workflow

- `intent_route`
- `extract_entities`
- `resolve_context`
- `plan_retrieval`
- `run_retrieval`
- `synthesize_answer`
- `validate_answer`
- `finalize`

### Tasks

- Move business logic out of large workflow nodes into service functions.
- Limit HITL to genuinely high-risk decision points.
- Avoid embedding low-level storage logic directly inside workflow nodes.
- Make route decisions deterministic where possible.

### Acceptance Criteria

- workflow nodes are short and composable
- most domain logic is testable without invoking LangGraph
- workflow transitions can be read quickly from one file

## Phase 4: Make Storage Auditable

Objective: retain the full retrieval trace needed for debugging and evaluation.

### Tasks

- Version the GraphRAG result schema.
- Persist:
  - user query
  - rewritten retrieval query
  - `kg_id`
  - `search_type`
  - retrieval backend
  - top evidence ids
  - source documents
  - latency
  - model name
  - workflow version
- Add migration utilities for schema changes.

### Files to refactor

- [agent/test_agent/graphrag_storage.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/test_agent/graphrag_storage.py)
- [agent/thread_message_store.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/thread_message_store.py)
- [agent/thread_routes.py](/E:/0CODE/graph-rag-agent/graph-rag-agent/QA_GRAPHRAG/agent/thread_routes.py)

### Acceptance Criteria

- a past answer can be replayed and debugged from stored retrieval metadata
- schema changes are migration-based, not ad hoc

## Phase 5: Add Evaluation and Regression Gates

Objective: make retrieval and answer quality measurable.

### Tasks

- Create `agent/evals/datasets/` with benchmark questions per KG.
- Include at least:
  - direct parameter lookup
  - multi-hop reasoning
  - ambiguous model selection
  - weak-evidence cases
  - impossible-answer cases
- Add scripts:
  - `python -m agent.evals.run_routing_eval`
  - `python -m agent.evals.run_retrieval_eval`
  - `python -m agent.evals.run_answer_eval`
- Track metrics:
  - routing accuracy
  - retrieval hit rate
  - grounding coverage
  - citation correctness
  - answer usefulness

### Acceptance Criteria

- every retrieval or prompt change can be checked against a baseline
- regressions are visible before merge

## Phase 6: CI and Developer Experience

Objective: make the repository easier to maintain across branches and environments.

### Tasks

- Add CI jobs for:
  - Python dependency install
  - frontend typecheck
  - backend import smoke test
  - KG artifact verification
  - core unit tests
- Add one command for local validation:
  - `scripts/check_all.ps1`
- Document the exact setup contract for adding a new KG.
- Add an environment template with required variables only.

### Acceptance Criteria

- a contributor can determine repository health with one command
- adding a new KG follows a documented checklist, not guesswork

## Suggested Execution Order

### Sprint 1

- Phase 0 fully complete
- disable silent fallback when artifacts are missing
- remove hardcoded secrets

### Sprint 2

- Phase 1 mostly complete
- primary retrieval interface introduced
- fallback policy made explicit

### Sprint 3

- Phase 2 and Phase 3
- structured evidence path live
- synthesis and quality check grounded

### Sprint 4

- Phase 4, Phase 5, and CI basics

## First Concrete Refactor Slice

If only one short implementation slice is started now, do this:

1. Add runtime and KG verification scripts.
2. Fix environment loading and secret management.
3. Make repository discovery reject incomplete KGs early.
4. Refactor `graphrag_query.py` into a clean retrieval service that returns normalized evidence objects.
5. Update `synthesize_node` to consume structured evidence instead of mostly free-form tool text.

This slice will remove the highest-risk uncertainty without forcing a full rewrite.
