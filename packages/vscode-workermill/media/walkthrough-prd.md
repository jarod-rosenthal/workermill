# Build an Entire Product from a Spec

WorkerMill's most powerful feature: submit a product requirements document and get a working, tested, deployed codebase.

### How to start a product build

1. Write your spec as a `.md` file — describe the product, features, tech stack, and constraints
2. Right-click the file in the Explorer
3. Select **WorkerMill: Product Build**

### What happens

1. **Decomposition** — the spec is analyzed and broken into a dependency-ordered Kanban board of cards
2. **Each card becomes a task** — with its own planning, multi-expert execution, and quality gates
3. **Cards execute in dependency order** — Card 0 (project setup) runs first, then Card 1 (CI/CD), then feature cards in parallel where possible
4. **Each card produces a PR** — building on the previous card's merged work

### Board structure

Every product build follows this pattern:

| Card | Purpose |
|------|---------|
| **Card 0** | Project setup, dev environment, dependencies |
| **Card 1** | CI/CD pipeline, quality gate configuration |
| **Cards 2-N** | Feature implementation (auth, API, UI, etc.) |
| **Last card** | Production deployment and validation |

### Monitor progress

Open the **web dashboard** to see the board, track card progress, and review each PR as it's created. The sidebar shows real-time coordination messages from active workers.
