# Codebase Indexing

Vector-based code search that gives workers deep understanding of your codebase before they start working. Workers receive relevant code snippets, patterns, and conventions automatically.

## How It Works

Codebase Indexing uses **vector embeddings** to semantically understand your code. Unlike keyword search, it finds code by meaning — "authentication middleware" finds the relevant code even if the file is named `auth.ts`.

### Indexing Pipeline

**Phase 1 — Chunking**
Your codebase is split into meaningful chunks — functions, classes, modules — preserving structure and context.

**Phase 2 — Embedding**
Each chunk is converted to a vector embedding using Ollama (`nomic-embed-text`). Embeddings capture semantic meaning, not just keywords.

**Phase 3 — Storage**
Embeddings are stored in PostgreSQL using pgvector for fast cosine similarity search.

**Phase 4 — Retrieval**
When a worker starts a task, relevant code is retrieved via similarity search and injected into the worker's context.

## Triggering Indexing

Index a repository from the **Settings → Codebase Indexing** page, or via the MCP server:

```
workermill_codebase_index(repository: "org/repo")
```

You can also force a full reindex:

```
workermill_codebase_index(repository: "org/repo", forceReindex: true)
```

## Checking Status

```
workermill_codebase_status(repository: "org/repo")
```

Status values: `pending`, `indexing`, `ready`, `failed`

## Searching Code

Once indexed, workers automatically use the index. You can also search manually via MCP:

```
workermill_codebase_search(repository: "org/repo", query: "authentication middleware")
workermill_codebase_symbol(repository: "org/repo", name: "UserService")
workermill_codebase_file(repository: "org/repo", path: "src/auth/middleware.ts")
```

## What Gets Indexed

- TypeScript / JavaScript
- Python
- Go
- Java
- Any language with tree-sitter support

Chunk types include: functions, classes, interfaces, type definitions, and file-level summaries.

## Notes

- Indexing requires Ollama with `nomic-embed-text` model to generate embeddings
- Large repositories (10,000+ files) may take several minutes to index
- The index updates automatically when workers commit code changes
- Branches are indexed separately — specify `branch` to search a specific branch
