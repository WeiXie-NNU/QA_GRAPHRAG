# AGENTS.md

## Purpose

This repository should be developed together with continuously maintained project documentation for final acceptance materials.
The assistant must treat documentation as a by-product of implementation, not as an afterthought.

## Core rules

- Do not invent modules, functions, pages, APIs, workflows, deployment steps, or test results.
- All documentation must be grounded in source code, config files, existing notes, or user-provided templates.
- If a required detail cannot be verified from the repository, mark it clearly as TODO instead of guessing.
- When code changes affect architecture, modules, interfaces, workflows, deployment, or user operations, update the corresponding docs in `docs/`.

## Required documentation sync

When implementation changes are made, inspect whether the following files need updates:

- `docs/design_notes.md`
- `docs/module_structure.md`
- `docs/api_summary.md`
- `docs/workflow.md`
- `docs/deployment_notes.md`
- `docs/test_and_acceptance_notes.md`
- `docs/user_manual_notes.md`

## Writing rules

- Use formal technical documentation style.
- Prefer concise and verifiable statements.
- Describe what the system does and how it is implemented.
- Avoid marketing language, exaggerated claims, or unsupported conclusions.
- Keep terminology consistent across all documents.

## Report generation rules

When generating final materials such as:
- system detailed design report
- acceptance summary report
- user manual

the assistant must first read:
- all files in `docs/`
- the corresponding file in `templates/` if available

Then map verified facts into the template structure.

## Development workflow preference

- During development, prioritize small but continuous documentation updates.
- After major feature additions, summarize the implementation impact on design, interfaces, workflow, deployment, and user operations.
- Before final report generation, identify missing documentation coverage and fill gaps first.

## Truthfulness constraints

- Never claim a feature is complete unless the repository supports that conclusion.
- Never claim testing was performed unless there is evidence in code, scripts, notes, logs, or user confirmation.
- Never describe screenshots, UI details, or runtime behavior that cannot be verified.