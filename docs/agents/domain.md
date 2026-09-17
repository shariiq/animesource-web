# Domain documentation

## Layout

This repository uses a single-context documentation layout:

- `CONTEXT.md` at the repository root describes the current domain and architecture.
- `docs/adr/` holds Architecture Decision Records.

## Consumer rules

Before making a non-trivial architectural or domain change:

1. Read `CONTEXT.md` when it exists.
2. Read relevant ADRs in `docs/adr/`.
3. Keep implementation consistent with accepted ADRs.
4. Add or update an ADR when a durable architectural decision is made.
