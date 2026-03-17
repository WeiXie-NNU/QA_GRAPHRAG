# QA_GRAPHRAG

QA_GRAPHRAG is a GraphRAG-oriented question answering workspace built around a React frontend, a CopilotKit runtime, and a Python agent service. It is designed for fast iteration on retrieval, graph-enhanced answers, visualization, and multi-user local history isolation.

## Overview

The repository contains three collaborating parts:

- Frontend: React + TypeScript + Vite application for chat, thread management, visualization, and local login.
- Runtime: Node.js CopilotKit runtime that bridges the UI and the backend agent.
- Backend: Python service responsible for agent orchestration, thread persistence, and GraphRAG-related processing.

## Current Capabilities

- Local multi-user login with per-user thread history isolation
- Thread creation, loading, rename, and deletion
- GraphRAG-oriented chat workflow
- Map, graph, and evidence-oriented visualization components
- SQLite-backed thread metadata and message persistence
- Frontend state management with React Query

## Tech Stack

- Frontend: React 18, TypeScript, Vite, React Router, React Query
- Runtime: Express, TypeScript, CopilotKit Runtime
- Backend: FastAPI-compatible Python service, LangGraph, SQLite

## Repository Layout

See the detailed structure guide here:

- [Project Structure](docs/project-structure.md)

Top-level directories:

- `src/`: frontend source code
- `agent/`: Python backend and thread management logic
- `runtime/`: CopilotKit runtime service
- `public/`: static assets bundled with the frontend
- `resources/`: local resource files used by the project
- `backend_test/`: backend experiments and test cases

## Quick Start

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Install Python dependencies

```bash
uv python install 3.11
uv venv --python 3.11 .venv
uv sync
```

### 3. Install runtime dependencies

```bash
cd runtime
npm install
cd ..
```

### 4. Start services

Backend:

```bash
.venv\Scripts\python agent\demo.py
```

Runtime:

```bash
cd runtime
npm run dev
```

Frontend:

```bash
npm run dev
```

## Default Ports

- Frontend: `5173`
- Runtime: `4000`
- Backend agent: `8089`

## Build

```bash
npm run build
```

## Important Files

- `src/main.tsx`: application bootstrap, routing, auth gate
- `src/App.tsx`: main workspace composition
- `src/services/threadService.ts`: thread API integration
- `agent/demo.py`: backend service entrypoint
- `agent/thread_routes.py`: thread and history APIs
- `runtime/server.ts`: CopilotKit runtime server

## Maintenance Notes

- This repository tracks source code and necessary static assets, but excludes local environments, databases, build outputs, and large generated knowledge artifacts.
- If you add a new user-facing feature, update both the frontend entry flow and the backend thread ownership checks when needed.
- Keep generated data under ignored directories instead of committing it to Git.

## Suggested Workflow

```bash
git pull
git checkout -b feature/your-change
git add .
git commit -m "feat: describe your change"
git push -u origin feature/your-change
```
