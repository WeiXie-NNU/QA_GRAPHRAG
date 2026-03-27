# Project Structure

This document explains where the important code lives and how to extend the project without turning the repository into a mixed collection of code and local artifacts.

## Top-Level Directories

### `src/`

Frontend application source.

- `main.tsx`: application bootstrap, route registration, auth guards
- `App.tsx`: main layout and chat workspace orchestration
- `components/`: reusable UI modules
- `contexts/`: shared state providers
- `hooks/`: frontend custom hooks
- `pages/`: route-level pages
- `services/`: browser-side API access
- `lib/`: shared utilities and types

### `agent/`

Python backend logic.

- `demo.py`: local backend entrypoint
- `thread_routes.py`: thread list, history, rename, delete, agent-state APIs
- `thread_message_store.py`: SQLite persistence helpers
- `thread_maintenance.py`: metadata initialization and maintenance helpers
- `test_agent/`: GraphRAG-oriented agent implementation and experiments

### `runtime/`

CopilotKit runtime service that connects the frontend and backend.

- `server.ts`: runtime server entrypoint
- `package.json`: runtime dependency and script definition

### `public/`

Static frontend assets that are served directly.

Examples:

- visualization libraries
- small parquet artifacts required by UI demos

### `resources/`

Local project resources such as administrative boundary data and reference files. Large repository archives and generated knowledge-base outputs should stay ignored unless they are truly required for runtime.

### `backend_test/`

Ad hoc backend test cases, notebooks, and helper scripts. Useful for validation, but not the place for production runtime logic.

## Recommended Change Boundaries

If you want to add or modify a feature, use these boundaries first:

- UI layout or interactions: `src/components/`, `src/pages/`, `src/App.tsx`
- Login or session behavior: `src/contexts/AuthContext.tsx`, `src/services/authService.ts`
- Thread list and history loading: `src/services/threadService.ts`, `src/hooks/useThreadList.ts`, `src/components/chat/useThreadHistory.ts`
- Historical thread restore is front-end driven through `/threads/{thread_id}/bootstrap`; thread list data is fetched from the backend and the database is the authoritative source for thread count and existence.
- Backend thread ownership or persistence: `agent/thread_routes.py`, `agent/thread_message_store.py`, `agent/thread_maintenance.py`
- Copilot bridge logic: `runtime/server.ts`

## Files That Should Usually Stay Out Of Git

These are intentionally ignored because they are environment-specific or too heavy for normal source control:

- `.venv/`
- `node_modules/`
- `dist/`
- `data/`
- `resources/repositories/`
- `resources/repositories.zip`
- `agent/test_agent/kg/`

## Practical Navigation Guide

When debugging a problem, this order usually saves time:

1. Check the page entry in `src/pages/` or the workspace shell in `src/App.tsx`.
2. Follow the related API call in `src/services/`.
3. Check the backend route in `agent/thread_routes.py`.
4. If persistence is involved, inspect `agent/thread_message_store.py`.
5. If the issue is in agent execution, continue into `agent/test_agent/`.

## Maintenance Suggestions

- Keep business logic close to the layer that owns it.
- Avoid storing generated outputs inside tracked source directories.
- Prefer documenting new modules in this file when the top-level structure changes.
- If a directory grows large, split by responsibility instead of by file type alone.
