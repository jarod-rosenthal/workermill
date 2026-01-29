# Vector Database Evaluation for Agent Memory System

**Date:** 2026-01-28
**Status:** Decision Made
**Decision:** pgvector (PostgreSQL extension)

---

## Executive Summary

This document evaluates three vector database options for WorkerMill's Agent Memory & Learning System: pgvector, Pinecone, and Weaviate. Based on WorkerMill's existing infrastructure, cost constraints, and operational simplicity requirements, **pgvector is the recommended choice**.

---

## Current Infrastructure Context

| Component | Value |
|-----------|-------|
| Database | PostgreSQL 16.8 |
| Hosting | AWS RDS (db.t4g.micro) |
| ORM | TypeORM |
| Region | us-east-1 |

---

## Options Evaluated

### 1. pgvector (PostgreSQL Extension)

**Overview:** Native PostgreSQL extension for vector similarity search. Stores embeddings alongside relational data in the same database.

| Criterion | Assessment |
|-----------|------------|
| **Infrastructure Change** | None - extension on existing RDS |
| **Cost** | $0 additional (uses existing RDS) |
| **Operational Complexity** | Low - same DB, same backups, same monitoring |
| **Performance** | Good for <1M vectors; scales with instance size |
| **Query Capability** | Full SQL joins with relational data |
| **AWS RDS Support** | Yes - PostgreSQL 16 supports pgvector |
| **TypeORM Integration** | Custom repository methods (straightforward) |

**Pros:**
- Zero additional infrastructure
- Zero additional cost
- Single source of truth (vectors + metadata in same DB)
- Full ACID transactions
- Leverage existing backups, monitoring, security
- Natural joins between embeddings and task/organization data

**Cons:**
- Scaling limited by RDS instance size
- Not optimized for billion-scale vector search
- No built-in hybrid search (requires manual implementation)

**Fit for WorkerMill:** Excellent. Memory system will store thousands to tens of thousands of embeddings per organization, well within pgvector's performance envelope.

---

### 2. Pinecone (Managed Vector Database)

**Overview:** Fully managed, purpose-built vector database as a service.

| Criterion | Assessment |
|-----------|------------|
| **Infrastructure Change** | New external service |
| **Cost** | $70+/month (Starter), scales with usage |
| **Operational Complexity** | Medium - new service to manage, new credentials |
| **Performance** | Excellent - optimized for vector search |
| **Query Capability** | Vector-only (metadata filtering limited) |
| **AWS RDS Support** | N/A - separate service |
| **TypeORM Integration** | None - separate client library |

**Pros:**
- Best-in-class vector search performance
- Serverless scaling
- No infrastructure management
- Built-in namespaces for multi-tenancy

**Cons:**
- Additional monthly cost ($70-700+/month)
- Data split between PostgreSQL and Pinecone
- Requires sync logic between systems
- No ACID transactions across systems
- Vendor lock-in
- Network latency for cross-service queries

**Fit for WorkerMill:** Overkill. Pinecone excels at billion-scale vector search. WorkerMill's memory system doesn't require this scale, and the added complexity/cost isn't justified.

---

### 3. Weaviate (Open Source Vector Database)

**Overview:** Open-source vector database with GraphQL API. Can be self-hosted or managed.

| Criterion | Assessment |
|-----------|------------|
| **Infrastructure Change** | New service (ECS task or managed) |
| **Cost** | Self-hosted: compute costs; Managed: $25+/month |
| **Operational Complexity** | High - new service, monitoring, backups |
| **Performance** | Excellent for hybrid search |
| **Query Capability** | GraphQL + vector + BM25 hybrid |
| **AWS RDS Support** | N/A - separate service |
| **TypeORM Integration** | None - separate client library |

**Pros:**
- Excellent hybrid search (vector + keyword)
- GraphQL API
- Open source (can self-host)
- Good for semantic search use cases

**Cons:**
- New infrastructure to deploy and manage
- Additional compute costs (ECS task)
- Data split between PostgreSQL and Weaviate
- Operational overhead (backups, monitoring, upgrades)
- Learning curve for GraphQL schema

**Fit for WorkerMill:** Poor cost/benefit ratio. The hybrid search capabilities are nice but don't justify the operational overhead for WorkerMill's use case.

---

## Decision Matrix

| Criterion | Weight | pgvector | Pinecone | Weaviate |
|-----------|--------|----------|----------|----------|
| Cost | 25% | 10 | 4 | 6 |
| Operational Simplicity | 25% | 10 | 6 | 4 |
| Performance at Scale | 15% | 6 | 10 | 9 |
| Data Consistency | 20% | 10 | 5 | 5 |
| Query Flexibility | 15% | 9 | 6 | 8 |
| **Weighted Score** | 100% | **9.25** | **5.85** | **6.05** |

---

## Recommendation: pgvector

### Rationale

1. **Zero Additional Cost:** WorkerMill is cost-conscious (db.t4g.micro RDS). pgvector adds no infrastructure cost.

2. **Operational Simplicity:** No new services to deploy, monitor, or maintain. Embeddings live in the same PostgreSQL database as tasks, organizations, and users.

3. **Data Consistency:** Memory entries can reference tasks, organizations, and repositories with proper foreign keys. ACID transactions ensure consistency.

4. **Sufficient Performance:** WorkerMill's memory system will store:
   - ~100-10,000 embeddings per organization
   - ~10-100 organizations initially
   - Total: <1M embeddings

   pgvector handles this scale easily with HNSW indexes.

5. **Natural Integration:** SQL queries can join embeddings with relational data:
   ```sql
   SELECT m.*, t.summary, o.name as org_name
   FROM memories m
   JOIN worker_tasks t ON m.task_id = t.id
   JOIN organizations o ON m.org_id = o.id
   WHERE m.embedding <=> $1 < 0.5
   ORDER BY m.embedding <=> $1
   LIMIT 10;
   ```

### Migration Path

If WorkerMill scales to millions of embeddings or requires sub-millisecond search:
1. Data is in PostgreSQL - can export to Pinecone/Weaviate later
2. Abstract the search interface behind a service layer
3. Migrate incrementally per organization if needed

---

## Implementation Plan

1. **Enable pgvector extension on RDS:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. **Add embedding columns to memory tables:**
   ```sql
   ALTER TABLE memories ADD COLUMN embedding vector(1536);
   CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);
   ```

3. **Create TypeORM custom repository for vector operations**

4. **Use OpenAI/Anthropic embeddings API for generating vectors**

---

## References

- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [AWS RDS pgvector Support](https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-rds-postgresql-pgvector-ml-model-integration/)
- [Pinecone Pricing](https://www.pinecone.io/pricing/)
- [Weaviate Documentation](https://weaviate.io/developers/weaviate)
