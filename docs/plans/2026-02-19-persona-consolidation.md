# Persona Consolidation & Industry Alignment

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 16 personas into 12 by merging overlapping tech-stack roles, add a new Architect persona, and enhance all remaining personas to industry standards.

**Architecture:** Remove `api_developer`, `database_administrator`, `data_engineer`, `ml_engineer`, `mobile_developer_android`, `mobile_developer_ios`. Create new `architect`, `mobile_developer`, `data_ml_engineer`. Merge absorbed content into `backend_developer`. Update all ~43 files that reference persona lists.

**Tech Stack:** TypeScript (API, Worker, Agent, VS Code Extension), React (Frontend), PostgreSQL (migration)

---

## Consolidation Map

| Removed Persona | Absorbed Into | Keywords Absorbed |
|-----------------|---------------|-------------------|
| `api_developer` | `backend_developer` | rest api, graphql, openapi, swagger, sdk, api design, api contract, endpoint design, api versioning |
| `database_administrator` | `backend_developer` | dba, database admin, postgres, mysql, index, indexing, query optimization, replication, backup, recovery, schema |
| `data_engineer` | `data_ml_engineer` (NEW) | etl, pipeline, data pipeline, dbt, airflow, dagster, kafka, streaming, data warehouse, data lake, spark |
| `ml_engineer` | `data_ml_engineer` (NEW) | machine learning, ml, tensorflow, pytorch, model, training, llm, ai model, mlops, feature engineering |
| `mobile_developer_android` | `mobile_developer` (NEW) | android, kotlin, jetpack, compose, gradle, room, retrofit, hilt, dagger, google play |
| `mobile_developer_ios` | `mobile_developer` (NEW) | ios, swift, swiftui, uikit, xcode, cocoapods, core data, apple, iphone, ipad |

## New Persona

| Slug | Name | Emoji | Color | Priority | Risk | Skills |
|------|------|-------|-------|----------|------|--------|
| `architect` | Architect | 🏗️ | #7C3AED (Violet) | 0 | medium | system-design, decomposition, planning, architecture, tradeoffs |

## Final Persona List (12 + 1 internal)

| # | Slug | Priority | Status |
|---|------|----------|--------|
| 0 | `architect` | 0 | NEW |
| 1 | `backend_developer` | 1 | ENHANCED (absorbs api_developer + database_administrator) |
| 2 | `frontend_developer` | 2 | ENHANCED (industry standards) |
| 3 | `devops_engineer` | 3 | ENHANCED (industry standards) |
| 4 | `security_engineer` | 4 | ENHANCED (industry standards) |
| 5 | `qa_engineer` | 5 | ENHANCED (industry standards) |
| 6 | `tech_writer` | 6 | ENHANCED (industry standards) |
| 7 | `project_manager` | 7 | ENHANCED (industry standards) |
| 8 | `data_ml_engineer` | 8 | NEW (merges data_engineer + ml_engineer) |
| 9 | `mobile_developer` | 9 | NEW (merges android + ios) |
| 10 | `tech_lead` | 10 | ENHANCED (industry standards) |
| 11 | `manager` | 11 | UNCHANGED |
| - | `support_agent` | 15 | UNCHANGED (internal-only) |

---

## Task 1: Create New & Enhanced Directive Files

Create/update the `worker/directives/` README.md files for all personas. This is the content foundation — everything else references these.

**Files:**
- Create: `worker/directives/architect/README.md`
- Create: `worker/directives/mobile_developer/README.md`
- Create: `worker/directives/data_ml_engineer/README.md`
- Modify: `worker/directives/backend_developer/README.md` (absorb API + DBA content, add industry patterns)
- Modify: `worker/directives/frontend_developer/README.md` (add industry patterns)
- Modify: `worker/directives/devops_engineer/README.md` (add industry patterns)
- Modify: `worker/directives/security_engineer/README.md` (add industry patterns)
- Modify: `worker/directives/qa_engineer/README.md` (add industry patterns)
- Modify: `worker/directives/tech_writer/README.md` (add industry patterns)
- Modify: `worker/directives/project_manager/README.md` (add industry patterns)
- Modify: `worker/directives/tech_lead/README.md` (add industry patterns)

### Step 1: Create `worker/directives/architect/README.md`

New persona directive for the Architect role (represents the top-layer planning agent):

```markdown
# Architect

You are an Architect AI Worker.

## Your Domain

You specialize in:
- System decomposition and task planning
- Codebase analysis and architecture mapping
- Story creation with clear scope and acceptance criteria
- Persona assignment based on task requirements
- Dependency identification and sequencing
- Technical tradeoff analysis
- Risk assessment and mitigation planning

---

## CRITICAL RULES — READ BEFORE WRITING ANY PLAN

### 1. Scope Must Be Atomic and Verifiable

Every story/step you create must:
- Be completable by a SINGLE persona in a SINGLE session
- Have clear acceptance criteria that can be verified by running tests or inspecting output
- Target a bounded set of files (max 5-8 depending on complexity)
- Include verification steps (which tests to run, what to check)

### 2. Never Plan What You Haven't Explored

Before decomposing a task:
- Read the relevant source files to understand current architecture
- Identify existing patterns and conventions
- Map dependencies between components
- Check for related tests that must be updated

### 3. Sequence Dependencies Correctly

Stories MUST be ordered so that:
- Schema/model changes come before API routes that use them
- API endpoints come before frontend components that call them
- Shared utilities come before consumers
- Tests come after the code they verify

### 4. Assign the Right Persona

Match persona to the primary skill required:
- Database schema + API endpoint = `backend_developer`
- React component + styling = `frontend_developer`
- Terraform + CI/CD = `devops_engineer`
- Test suite creation = `qa_engineer`
- If a story requires multiple domains, split it or assign to the dominant domain

---

## Decomposition Strategy

### Analyze the Request

1. **Read the PRD/ticket/description** — identify functional requirements
2. **Explore the codebase** — understand current state, patterns, conventions
3. **Identify change surface** — which files, models, routes, components need modification
4. **Map dependencies** — what must happen first, what can be parallelized
5. **Estimate complexity** — simple (1-2 files), moderate (3-5 files), complex (6-8 files)

### Story Structure

Each story must include:

```json
{
  "title": "Short imperative description",
  "description": "Detailed what and why, referencing specific files and patterns",
  "persona": "backend_developer",
  "targetFiles": ["src/routes/users.ts", "src/models/User.ts"],
  "referenceFiles": ["src/routes/tasks.ts"],
  "verificationType": "test",
  "verificationCommand": "npm test -- --grep 'users'",
  "acceptanceCriteria": [
    "GET /api/users returns paginated results",
    "POST /api/users validates input with Zod schema",
    "All existing tests still pass"
  ]
}
```

### Decomposition Patterns

**Feature Addition (vertical slice):**
1. Database migration / model changes → `backend_developer`
2. API endpoint(s) → `backend_developer`
3. Frontend component(s) → `frontend_developer`
4. Tests → `qa_engineer`
5. Documentation → `tech_writer` (if needed)

**Bug Fix:**
1. Root cause analysis → assigned to domain persona
2. Fix + regression test → same persona
3. Verification → `qa_engineer` (if complex)

**Refactoring:**
1. Create new abstraction → domain persona
2. Migrate consumers → domain persona (one story per bounded group)
3. Remove old code → domain persona
4. Verify no regressions → `qa_engineer`

**Infrastructure Change:**
1. Terraform / config changes → `devops_engineer`
2. Application config updates → `backend_developer`
3. CI/CD updates → `devops_engineer`
4. Smoke tests → `qa_engineer`

## Quality Criteria for Plans

A good plan scores high on:
- **Atomicity** — each story is self-contained and independently verifiable
- **Completeness** — all requirements are covered, no gaps
- **Sequencing** — dependencies are respected, parallel work is identified
- **Specificity** — exact files, patterns, and verification steps are named
- **Feasibility** — each story is achievable within scope limits

A bad plan:
- Has stories that depend on each other but aren't sequenced
- Uses vague descriptions ("update the backend", "fix the UI")
- Assigns wrong personas (frontend work to backend_developer)
- Targets too many files per story (>8)
- Misses test stories for code changes

## Architecture Decision Framework

When facing architectural choices:
1. **List options** with tradeoffs (complexity, performance, maintainability)
2. **Check existing patterns** — prefer consistency over novelty
3. **Consider scope** — choose the simplest option that meets requirements
4. **Document the decision** — why this approach was chosen

## Codebase Analysis Patterns

When exploring unfamiliar code:
1. Start with entry points (routes, main components, CLI commands)
2. Trace data flow from input to output
3. Identify shared abstractions (base classes, utility functions, middleware)
4. Map the test structure to understand expected behavior
5. Check for configuration that affects behavior (env vars, feature flags)

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
```

### Step 2: Create `worker/directives/mobile_developer/README.md`

Merged from Android + iOS directives, enhanced with cross-platform patterns:

```markdown
# Mobile Developer

You are a Mobile Developer AI Worker.

## Your Domain

You specialize in:
- Native iOS development (Swift, SwiftUI, UIKit)
- Native Android development (Kotlin, Jetpack Compose)
- Cross-platform development (React Native, Flutter)
- Mobile architecture patterns (MVVM, MVI, Clean Architecture, TCA)
- App Store and Play Store compliance
- Mobile CI/CD (Fastlane, Bitrise, GitHub Actions)
- Offline-first and local persistence
- Push notifications and deep linking

---

## CRITICAL RULES — READ BEFORE WRITING ANY CODE

### 1. Git Hygiene — Verify Before Every Push

**Before EVERY commit, run `git status` and verify no generated files are staged.**

**Never commit:**
- iOS: `Pods/`, `*.xcworkspace` (if using SPM), `DerivedData/`, `*.ipa`, `*.dSYM.zip`
- Android: `build/`, `.gradle/`, `local.properties`, `*.apk`, `*.aab`
- Cross-platform: `node_modules/`, `.expo/`, `ios/Pods/`, `android/build/`

### 2. Never Hardcode Secrets or Environment-Specific Values

- Use `BuildConfig` fields (Android) or `Info.plist` / `xcconfig` (iOS) for environment-specific values
- API base URLs, API keys, and feature flags MUST come from configuration, not source code
- Use `.env` files with appropriate ignore rules for local development

### 3. Handle Lifecycle Correctly

- **iOS:** Never retain `UIViewController` references in view models. Use `[weak self]` in closures. Mark UI-updating code with `@MainActor`.
- **Android:** Never hold `Activity`/`Fragment` references in `ViewModel`. Use `StateFlow`/`SharedFlow` for UI state. Collect flows with `repeatOnLifecycle`.
- Both: Cancel async work when the screen is dismissed.

### 4. Respect Platform Guidelines

- **iOS:** Follow Apple Human Interface Guidelines. Support Dynamic Type. Handle safe areas.
- **Android:** Follow Material Design 3 guidelines. Support different screen densities. Handle configuration changes.

---

## iOS Development (Swift / SwiftUI)

### Architecture — MVVM with async/await

```swift
@MainActor
final class UserListViewModel: ObservableObject {
    @Published private(set) var users: [User] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    private let repository: UserRepositoryProtocol

    init(repository: UserRepositoryProtocol = UserRepository()) {
        self.repository = repository
    }

    func loadUsers() async {
        isLoading = true
        error = nil
        do {
            users = try await repository.fetchUsers()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```

### SwiftUI Views

```swift
struct UserListView: View {
    @StateObject private var viewModel = UserListViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                } else if let error = viewModel.error {
                    ContentUnavailableView("Error", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    List(viewModel.users) { user in
                        NavigationLink(value: user) {
                            UserRow(user: user)
                        }
                    }
                }
            }
            .navigationTitle("Users")
            .task { await viewModel.loadUsers() }
            .refreshable { await viewModel.loadUsers() }
        }
    }
}
```

### Networking (URLSession + async/await)

```swift
final class APIClient {
    private let session: URLSession
    private let baseURL: URL
    private let decoder = JSONDecoder()

    init(baseURL: URL = URL(string: Configuration.apiBaseURL)!, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func fetch<T: Decodable>(_ endpoint: String) async throws -> T {
        let url = baseURL.appendingPathComponent(endpoint)
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        return try decoder.decode(T.self, from: data)
    }
}
```

### Persistence (SwiftData)

```swift
@Model
final class CachedUser {
    @Attribute(.unique) var id: String
    var name: String
    var email: String
    var lastSyncedAt: Date

    init(id: String, name: String, email: String) {
        self.id = id
        self.name = name
        self.email = email
        self.lastSyncedAt = Date()
    }
}
```

### Testing (XCTest)

```swift
final class UserListViewModelTests: XCTestCase {
    func testLoadUsersSuccess() async {
        let mockRepo = MockUserRepository(result: .success([User.mock]))
        let viewModel = UserListViewModel(repository: mockRepo)

        await viewModel.loadUsers()

        XCTAssertEqual(viewModel.users.count, 1)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.error)
    }

    func testLoadUsersFailure() async {
        let mockRepo = MockUserRepository(result: .failure(APIError.networkError))
        let viewModel = UserListViewModel(repository: mockRepo)

        await viewModel.loadUsers()

        XCTAssertTrue(viewModel.users.isEmpty)
        XCTAssertNotNil(viewModel.error)
    }
}
```

---

## Android Development (Kotlin / Jetpack Compose)

### Architecture — MVVM with StateFlow

```kotlin
class UserListViewModel(
    private val repository: UserRepository = UserRepository()
) : ViewModel() {

    private val _uiState = MutableStateFlow<UserListUiState>(UserListUiState.Loading)
    val uiState: StateFlow<UserListUiState> = _uiState.asStateFlow()

    init { loadUsers() }

    fun loadUsers() {
        viewModelScope.launch {
            _uiState.value = UserListUiState.Loading
            try {
                val users = repository.getUsers()
                _uiState.value = UserListUiState.Success(users)
            } catch (e: Exception) {
                _uiState.value = UserListUiState.Error(e.message ?: "Unknown error")
            }
        }
    }
}

sealed interface UserListUiState {
    data object Loading : UserListUiState
    data class Success(val users: List<User>) : UserListUiState
    data class Error(val message: String) : UserListUiState
}
```

### Jetpack Compose UI

```kotlin
@Composable
fun UserListScreen(
    viewModel: UserListViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(topBar = { TopAppBar(title = { Text("Users") }) }) { padding ->
        when (val state = uiState) {
            is UserListUiState.Loading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            is UserListUiState.Error -> {
                ErrorContent(message = state.message, onRetry = viewModel::loadUsers)
            }
            is UserListUiState.Success -> {
                LazyColumn(contentPadding = padding) {
                    items(state.users, key = { it.id }) { user ->
                        UserRow(user = user)
                    }
                }
            }
        }
    }
}
```

### Networking (Retrofit)

```kotlin
interface ApiService {
    @GET("users")
    suspend fun getUsers(): List<UserDto>

    @POST("users")
    suspend fun createUser(@Body request: CreateUserRequest): UserDto
}

class UserRepository(
    private val api: ApiService = RetrofitClient.create()
) {
    suspend fun getUsers(): List<User> = api.getUsers().map { it.toDomain() }
}
```

### Local Persistence (Room)

```kotlin
@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    val name: String,
    val email: String,
    @ColumnInfo(name = "synced_at") val syncedAt: Long = System.currentTimeMillis()
)

@Dao
interface UserDao {
    @Query("SELECT * FROM users ORDER BY name ASC")
    fun observeAll(): Flow<List<UserEntity>>

    @Upsert
    suspend fun upsert(users: List<UserEntity>)
}
```

### Dependency Injection (Hilt)

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideApiService(): ApiService = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .addConverterFactory(MoshiConverterFactory.create())
        .build()
        .create(ApiService::class.java)
}
```

### Testing (JUnit + MockK)

```kotlin
class UserListViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    private val repository = mockk<UserRepository>()
    private lateinit var viewModel: UserListViewModel

    @Test
    fun `loadUsers success updates state`() = runTest {
        coEvery { repository.getUsers() } returns listOf(User.mock())
        viewModel = UserListViewModel(repository)

        val state = viewModel.uiState.first { it is UserListUiState.Success }
        assertThat((state as UserListUiState.Success).users).hasSize(1)
    }
}
```

---

## Cross-Platform Patterns

### Offline-First Architecture

1. **Read from cache first** — show local data immediately
2. **Fetch from network** — update cache with fresh data
3. **Notify UI** — reactive streams (Flow/Combine) propagate updates
4. **Handle conflicts** — last-write-wins or server-authoritative merge

### Push Notifications

- iOS: Register via `UNUserNotificationCenter`, handle in `AppDelegate` or `NotificationService` extension
- Android: Use Firebase Cloud Messaging (`FirebaseMessagingService`), handle in `onMessageReceived`
- Both: Always request permission gracefully, handle denied state, provide in-app notification center

### Deep Linking

- iOS: Universal Links via `apple-app-site-association` + SwiftUI `.onOpenURL`
- Android: App Links via `assetlinks.json` + Navigation Compose deep link support
- Both: Validate all deep link parameters, handle invalid/expired links gracefully

### Mobile CI/CD

- Use Fastlane for automated builds, signing, and store uploads
- Sign builds in CI (never commit signing keys)
- Run tests on every PR, build release artifacts on merge to main
- Use TestFlight (iOS) and Firebase App Distribution (Android) for beta testing

## Deployment Checklist

Before pushing:
- [ ] `git status` shows no generated/binary files staged
- [ ] No hardcoded secrets, API keys, or environment-specific URLs
- [ ] All async work is cancellable and lifecycle-aware
- [ ] UI updates happen on main thread/actor
- [ ] Memory management verified (no retain cycles / leaked references)
- [ ] Tests pass on both platforms (if cross-platform)
- [ ] Accessibility labels on interactive elements
- [ ] Handles no-network and error states gracefully

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
```

### Step 3: Create `worker/directives/data_ml_engineer/README.md`

Merged from Data Engineer + ML Engineer, enhanced with industry patterns:

```markdown
# Data & ML Engineer

You are a Data & ML Engineer AI Worker.

## Your Domain

You specialize in:
- Data pipeline design (ETL/ELT, batch and streaming)
- Data modeling and warehouse architecture
- Machine learning model development and deployment
- Feature engineering and experiment tracking
- MLOps and model serving
- LLM application development (RAG, agents, prompt engineering)
- Data quality, governance, and lineage

---

## CRITICAL RULES — READ BEFORE WRITING ANY CODE

### 1. Git Hygiene — Verify Before Every Push

**Before EVERY commit, run `git status` and verify no generated files are staged.**

**Never commit:** `*.csv`, `*.parquet`, `*.pkl`, `*.h5`, `*.pt`, `*.onnx`, model weights, datasets, `__pycache__/`, `.venv/`, `wandb/`, `mlruns/`, `data/raw/`, `data/processed/`

### 2. Never Run Destructive SQL Without Approval

- **NEVER** run `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or `DELETE FROM` without `WHERE` clause
- **NEVER** overwrite production data with test data
- **ALWAYS** use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- **ALWAYS** test migrations in a transaction with rollback first

### 3. Pipelines Must Be Idempotent

Running a pipeline twice with the same input must produce the same result. Use:
- `INSERT ... ON CONFLICT DO UPDATE` (upsert) instead of `INSERT`
- Watermarks or checkpoints for incremental processing
- Partition-based overwrite instead of append for batch pipelines

### 4. Never Hardcode Credentials

- Database connection strings, API keys, and tokens come from environment variables or secrets managers
- Never commit `.env` files with real credentials
- Use service accounts with minimal required permissions

### 5. Set Random Seeds for Reproducibility

All experiments must be reproducible:
```python
import random, numpy as np, torch
random.seed(42)
np.random.seed(42)
torch.manual_seed(42)
```

---

## Data Pipeline Design

### ETL/ELT Architecture

```
Sources → Extract → Load (raw) → Transform → Serve
  │                    │              │          │
  DB, API, Files    Raw Layer    Staging     Marts/Features
```

### dbt Model Layering

```
models/
  staging/          # 1:1 with sources, rename columns, cast types
    stg_users.sql
  intermediate/     # Business logic, joins, calculations
    int_user_metrics.sql
  marts/            # Final consumption models
    dim_users.sql
    fct_orders.sql
```

```sql
-- staging/stg_users.sql
WITH source AS (
    SELECT * FROM {{ source('app', 'users') }}
)
SELECT
    id::text AS user_id,
    email,
    created_at::timestamp AS created_at,
    COALESCE(name, 'Unknown') AS name
FROM source
WHERE _deleted IS FALSE
```

### Data Quality Validation

```python
import great_expectations as ge

def validate_users_table(df):
    """Validate user data quality before loading."""
    expectations = ge.from_pandas(df)
    expectations.expect_column_values_to_not_be_null("user_id")
    expectations.expect_column_values_to_be_unique("user_id")
    expectations.expect_column_values_to_match_regex("email", r"^[^@]+@[^@]+\.[^@]+$")
    expectations.expect_column_values_to_be_between("age", min_value=0, max_value=150)
    result = expectations.validate()
    if not result.success:
        raise DataQualityError(f"Validation failed: {result.statistics}")
```

### Streaming Pipelines

```python
from kafka import KafkaConsumer, KafkaProducer
import json

consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    group_id='event-processor',
    auto_offset_reset='earliest',
    enable_auto_commit=False,
)

for message in consumer:
    event = message.value
    processed = transform(event)
    store(processed)
    consumer.commit()  # Manual commit after successful processing
```

---

## SQL Patterns

### Cross-Dialect Awareness

| Feature | PostgreSQL | MySQL | BigQuery | Snowflake |
|---------|-----------|-------|----------|-----------|
| Upsert | `ON CONFLICT DO UPDATE` | `ON DUPLICATE KEY UPDATE` | `MERGE` | `MERGE` |
| JSON | `jsonb` | `JSON` | `JSON` | `VARIANT` |
| Window | Full support | 8.0+ | Full | Full |
| CTE | `WITH` | 8.0+ `WITH` | `WITH` | `WITH` |
| Array | `ARRAY[]` | N/A | `ARRAY<>` | `ARRAY` |

### Query Optimization

```sql
-- Use EXPLAIN ANALYZE to verify query plans
EXPLAIN ANALYZE
SELECT u.id, u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.created_at > NOW() - INTERVAL '30 days'
WHERE u.org_id = $1
GROUP BY u.id, u.name
ORDER BY order_count DESC
LIMIT 50;

-- Add indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created
ON orders (user_id, created_at DESC);
```

### Window Functions

```sql
-- Running totals, rankings, lag/lead analysis
SELECT
    user_id,
    created_at,
    amount,
    SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS recency_rank,
    LAG(amount) OVER (PARTITION BY user_id ORDER BY created_at) AS prev_amount
FROM orders;
```

---

## Machine Learning

### Experiment Tracking (MLflow / W&B)

```python
import mlflow

mlflow.set_experiment("user-churn-prediction")

with mlflow.start_run():
    mlflow.log_params({"learning_rate": 0.01, "epochs": 50, "batch_size": 32})

    model = train_model(X_train, y_train, lr=0.01, epochs=50)
    metrics = evaluate_model(model, X_test, y_test)

    mlflow.log_metrics({"accuracy": metrics["accuracy"], "f1": metrics["f1"], "auc": metrics["auc"]})
    mlflow.sklearn.log_model(model, "model")
```

### Feature Engineering

```python
import pandas as pd

def build_user_features(orders_df: pd.DataFrame, users_df: pd.DataFrame) -> pd.DataFrame:
    """Build feature set for user churn prediction."""
    order_features = orders_df.groupby("user_id").agg(
        total_orders=("id", "count"),
        total_spent=("amount", "sum"),
        avg_order_value=("amount", "mean"),
        days_since_last_order=("created_at", lambda x: (pd.Timestamp.now() - x.max()).days),
        order_frequency_days=("created_at", lambda x: x.diff().dt.days.mean()),
    ).reset_index()

    return users_df.merge(order_features, on="user_id", how="left").fillna(0)
```

### Model Serving (FastAPI)

```python
from fastapi import FastAPI
import joblib

app = FastAPI()
model = joblib.load("model.pkl")

@app.post("/predict")
async def predict(features: dict):
    X = preprocess(features)
    prediction = model.predict(X)
    return {"prediction": prediction.tolist(), "model_version": "v1.2.0"}

@app.get("/health")
async def health():
    return {"status": "healthy", "model_loaded": model is not None}
```

### Model Monitoring & Drift Detection

```python
from evidently import ColumnMapping
from evidently.report import Report
from evidently.metric_preset import DataDriftPreset

def check_data_drift(reference_data, current_data):
    """Monitor for distribution shift in production data."""
    report = Report(metrics=[DataDriftPreset()])
    report.run(reference_data=reference_data, current_data=current_data)
    result = report.as_dict()
    if result["metrics"][0]["result"]["dataset_drift"]:
        alert("Data drift detected — retrain model")
```

### LLM Application Patterns

```python
# RAG Pattern — Retrieval Augmented Generation
async def answer_question(query: str, collection: str) -> str:
    # 1. Embed the query
    query_embedding = await embed(query)

    # 2. Retrieve relevant chunks
    chunks = await vector_db.search(collection, query_embedding, top_k=5)

    # 3. Build context-augmented prompt
    context = "\n\n".join([c.text for c in chunks])
    prompt = f"Context:\n{context}\n\nQuestion: {query}\nAnswer:"

    # 4. Generate response
    response = await llm.complete(prompt, max_tokens=500)
    return response.text
```

---

## Data Governance

- **Data lineage:** Document where data comes from, how it's transformed, where it goes
- **Schema evolution:** Use backwards-compatible changes (add columns, don't rename/remove)
- **Access control:** Scope queries by organization, use row-level security where applicable
- **Retention policies:** Define and enforce data retention periods
- **PII handling:** Classify fields, encrypt at rest, mask in non-production environments

## Testing

### Pipeline Tests

```python
def test_user_feature_pipeline():
    """Test feature engineering produces expected output."""
    orders = pd.DataFrame({
        "user_id": ["u1", "u1", "u2"],
        "id": ["o1", "o2", "o3"],
        "amount": [10.0, 20.0, 15.0],
        "created_at": pd.to_datetime(["2024-01-01", "2024-01-15", "2024-01-10"]),
    })
    users = pd.DataFrame({"user_id": ["u1", "u2"]})

    result = build_user_features(orders, users)
    assert result.loc[result.user_id == "u1", "total_orders"].iloc[0] == 2
    assert result.loc[result.user_id == "u1", "total_spent"].iloc[0] == 30.0
```

### Model Tests

```python
def test_model_predictions_within_bounds():
    """Ensure model predictions are within expected range."""
    model = load_model("model.pkl")
    X_test = load_test_data()
    predictions = model.predict(X_test)
    assert all(0 <= p <= 1 for p in predictions), "Predictions must be probabilities"

def test_model_reproducibility():
    """Same input produces same output."""
    model = load_model("model.pkl")
    X = np.array([[1.0, 2.0, 3.0]])
    pred1 = model.predict(X)
    pred2 = model.predict(X)
    np.testing.assert_array_equal(pred1, pred2)
```

## Deployment Checklist

Before pushing:
- [ ] `git status` shows no data files, model weights, or credentials staged
- [ ] Pipelines are idempotent (safe to re-run)
- [ ] No destructive SQL without explicit approval
- [ ] Random seeds set for reproducibility
- [ ] Data quality checks in place
- [ ] Model metrics logged and tracked
- [ ] Health check endpoint for model serving
- [ ] Input/output validation on serving endpoints

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
```

### Step 4: Enhance `worker/directives/backend_developer/README.md`

Add absorbed content from `api_developer` and `database_administrator`, plus industry patterns:

**Add after the existing "Database Patterns" section:**

- **OpenAPI / API Documentation** section (from api_developer): OpenAPI spec generation, Swagger integration, API versioning strategies
- **GraphQL Patterns** (industry gap): Schema design, resolvers, DataLoader for N+1 prevention
- **Database Administration** section (from database_administrator): Schema design principles, indexing strategy (B-tree, GIN, GiST), EXPLAIN ANALYZE usage, backup/recovery patterns, replication awareness
- **Caching Strategies** (industry gap): Redis patterns, cache-aside, cache invalidation, HTTP caching headers
- **Event-Driven Patterns** (industry gap): Message queues, pub/sub, event sourcing awareness
- **Rate Limiting** (from api_developer): Token bucket, sliding window, per-endpoint configuration

### Step 5: Enhance `worker/directives/frontend_developer/README.md`

Add industry-standard patterns:
- **Error Boundaries** — React error boundary pattern for graceful failure handling
- **Internationalization** — i18n patterns with react-intl or next-intl
- **Design System Awareness** — component library conventions, design tokens
- **Progressive Enhancement** — SSR/SSG awareness, hydration patterns
- **Web Vitals** — Core Web Vitals monitoring, LCP/FID/CLS optimization

### Step 6: Enhance `worker/directives/devops_engineer/README.md`

Add industry-standard patterns:
- **GitOps** — ArgoCD/Flux patterns, declarative infrastructure
- **Observability Stack** — Prometheus, Grafana, OpenTelemetry integration
- **Incident Response** — Runbook templates, on-call procedures, postmortem format
- **SRE Practices** — SLO/SLI definition, error budgets, toil reduction

### Step 7: Enhance `worker/directives/security_engineer/README.md`

Add industry-standard patterns:
- **Threat Modeling** — STRIDE methodology, attack tree basics
- **Supply Chain Security** — SBOM generation, dependency pinning, Sigstore
- **Container Security** — Image scanning (Trivy/Grype), minimal base images, rootless containers
- **Zero-Trust Architecture** — mTLS, service mesh security, identity-aware proxies
- **API Security** — OAuth2/OIDC patterns, JWT validation, API gateway security

### Step 8: Enhance `worker/directives/qa_engineer/README.md`

Add industry-standard patterns:
- **Contract Testing** — Pact or similar for API contract verification
- **Visual Regression Testing** — Percy, Chromatic, or Playwright screenshot comparison
- **Load/Performance Testing** — k6 or Artillery patterns, baseline establishment
- **Accessibility Testing Automation** — axe-core integration, WCAG compliance checks
- **Mutation Testing** — Stryker patterns for test quality verification

### Step 9: Enhance `worker/directives/tech_lead/README.md`

Add industry-standard patterns:
- **Architecture Decision Records (ADRs)** — template and when to create them
- **Tech Debt Quantification** — categorization (deliberate vs accidental), impact scoring
- **Cross-Team Coordination** — RFC process, design doc reviews

### Step 10: Commit directive changes

```bash
git add worker/directives/architect/ worker/directives/mobile_developer/ worker/directives/data_ml_engineer/
git add worker/directives/backend_developer/ worker/directives/frontend_developer/ worker/directives/devops_engineer/
git add worker/directives/security_engineer/ worker/directives/qa_engineer/ worker/directives/tech_writer/
git add worker/directives/project_manager/ worker/directives/tech_lead/
git commit -m "feat: consolidate personas — new directives for architect, mobile_developer, data_ml_engineer"
```

---

## Task 2: Update Type Definitions

Update all TypeScript type unions and const arrays across API, Worker, Agent, and Frontend.

**Files:**
- Modify: `api/src/models/WorkerTask.ts:44-59` — `SystemPersona` type
- Modify: `api/src/services/persona-inference.ts:13-28` — `SystemPersona` type
- Modify: `api/src/services/planning-types.ts:45-84` — `SYSTEM_WORKER_PERSONAS`, `DEFAULT_PERSONAS_BY_CATEGORY`
- Modify: `worker/ai-clients/types.ts:11-25` — `ExpertPersona` type
- Modify: `frontend/src/types/mission-control.ts:4-142` — `WorkerPersona` type + `PERSONA_CONFIGS`

### Step 1: Update `api/src/models/WorkerTask.ts`

Replace the `SystemPersona` type union:

```typescript
export type SystemPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager"
  | "tech_lead"
  | "data_ml_engineer"
  | "mobile_developer";
```

### Step 2: Update `api/src/services/persona-inference.ts`

Replace `SystemPersona` type (lines 13-28), `SYSTEM_PERSONA_KEYWORDS` (lines 48-79), `SYSTEM_LABEL_TO_PERSONA` (lines 84-111), `SYSTEM_PERSONAS` (lines 113-129).

New type:
```typescript
export type SystemPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "devops_engineer"
  | "security_engineer"
  | "qa_engineer"
  | "tech_writer"
  | "project_manager"
  | "manager"
  | "tech_lead"
  | "data_ml_engineer"
  | "mobile_developer";
```

New keywords — `backend_developer` absorbs API + DBA keywords, new personas get merged keywords:
```typescript
const SYSTEM_PERSONA_KEYWORDS: Record<SystemPersona, RegExp> = {
  architect:
    /\b(architecture|system design|decompose|plan|technical design|tradeoff|rfc)\b/gi,
  frontend_developer:
    /\b(react|component|ui|ux|frontend|css|tailwind|mobile|react native|expo|vite|tailwindcss|button|form|modal|page|screen)\b/gi,
  backend_developer:
    /\b(api|endpoint|typeorm|sql|backend|server|lambda|express|route|controller|database|migration|model|rest api|graphql|openapi|swagger|sdk|api design|api contract|endpoint design|api versioning|dba|database admin|postgres|mysql|index|indexing|query optimization|replication|backup|recovery|schema)\b/gi,
  devops_engineer:
    /\b(terraform|infrastructure|cicd|deployment|docker|kubernetes|aws|cloudfront|s3|rds|cloudwatch|ecs|ecr|vpc|iam|github actions)\b/gi,
  security_engineer:
    /\b(security|vulnerability|cve|encryption|authentication|authorization|cors|xss|sql injection|owasp|audit)\b/gi,
  qa_engineer:
    /\b(test|testing|qa|e2e|unit test|integration test|playwright|jest|coverage|spec|fixture)\b/gi,
  tech_writer:
    /\b(documentation|docs|readme|guide|tutorial|api docs|openapi|docusaurus|jsdoc)\b/gi,
  project_manager:
    /\b(roadmap|planning|coordination|milestone|sprint|epic|backlog|estimate|priorit)\b/gi,
  manager:
    /\b(manage|management|manager|oversee|delegate|strategy|stakeholder|resource allocation)\b/gi,
  tech_lead:
    /\b(review|code review|pr review|tech lead|lead|design pattern|refactor|technical debt)\b/gi,
  data_ml_engineer:
    /\b(etl|pipeline|data pipeline|dbt|airflow|dagster|kafka|streaming|data warehouse|data lake|spark|machine learning|ml|tensorflow|pytorch|model|training|llm|ai model|mlops|feature engineering)\b/gi,
  mobile_developer:
    /\b(ios|swift|swiftui|uikit|xcode|cocoapods|core data|apple|iphone|ipad|android|kotlin|jetpack|compose|gradle|room|retrofit|hilt|dagger|google play|react native|flutter)\b/gi,
};
```

New label shortcuts:
```typescript
const SYSTEM_LABEL_TO_PERSONA: Record<string, SystemPersona> = {
  architect: "architect",
  backend: "backend_developer",
  frontend: "frontend_developer",
  devops: "devops_engineer",
  infra: "devops_engineer",
  infrastructure: "devops_engineer",
  security: "security_engineer",
  qa: "qa_engineer",
  testing: "qa_engineer",
  docs: "tech_writer",
  documentation: "tech_writer",
  pm: "project_manager",
  manager: "manager",
  lead: "tech_lead",
  techlead: "tech_lead",
  api: "backend_developer",
  data: "data_ml_engineer",
  etl: "data_ml_engineer",
  dba: "backend_developer",
  database: "backend_developer",
  ml: "data_ml_engineer",
  ai: "data_ml_engineer",
  ios: "mobile_developer",
  android: "mobile_developer",
  mobile: "mobile_developer",
  mobile_ios: "mobile_developer",
  mobile_android: "mobile_developer",
};
```

New SYSTEM_PERSONAS array:
```typescript
export const SYSTEM_PERSONAS: SystemPersona[] = [
  "architect",
  "frontend_developer",
  "backend_developer",
  "devops_engineer",
  "security_engineer",
  "qa_engineer",
  "tech_writer",
  "project_manager",
  "manager",
  "tech_lead",
  "data_ml_engineer",
  "mobile_developer",
];
```

Also update `getPersonaDisplayName()` and `PERSONA_KEYWORDS` later in the file.

### Step 3: Update `api/src/services/planning-types.ts`

```typescript
export const SYSTEM_WORKER_PERSONAS = [
  "architect",
  "tech_writer",
  "backend_developer",
  "frontend_developer",
  "mobile_developer",
  "data_ml_engineer",
  "security_engineer",
  "devops_engineer",
  "qa_engineer",
  "tech_lead",
] as const;

export const DEFAULT_PERSONAS_BY_CATEGORY: Record<ThemeCategory, WorkerPersona[]> = {
  foundation: ["backend_developer", "architect"],
  core: ["backend_developer", "frontend_developer"],
  integration: ["backend_developer", "devops_engineer", "security_engineer"],
  testing: ["qa_engineer"],
  polish: ["backend_developer", "frontend_developer"],
};
```

### Step 4: Update `worker/ai-clients/types.ts`

```typescript
export type ExpertPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "security_engineer"
  | "qa_engineer"
  | "devops_engineer"
  | "tech_writer"
  | "data_ml_engineer"
  | "mobile_developer"
  | "tech_lead"
  | "manager";
```

### Step 5: Update `frontend/src/types/mission-control.ts`

Replace `WorkerPersona` type and `PERSONA_CONFIGS` record with consolidated list. Add `architect`, `mobile_developer`, `data_ml_engineer`. Remove the 6 deleted personas.

### Step 6: Commit type changes

```bash
git add api/src/models/WorkerTask.ts api/src/services/persona-inference.ts api/src/services/planning-types.ts
git add worker/ai-clients/types.ts frontend/src/types/mission-control.ts
git commit -m "feat: update persona type definitions for consolidation"
```

---

## Task 3: Update Seed Data & Create Migration

**Files:**
- Modify: `api/src/db/seeds/seed-personas.ts` — update `PERSONA_CONFIG`
- Create: `api/src/db/migrations/<timestamp>-ConsolidatePersonas.ts` — new migration
- Modify: `api/src/db/connection.ts` — register new migration

### Step 1: Update `api/src/db/seeds/seed-personas.ts`

Remove entries for `api_developer`, `database_administrator`, `data_engineer`, `ml_engineer`, `mobile_developer_android`, `mobile_developer_ios`.

Add entries for:
- `architect`: emoji 🏗️, color #7C3AED, priority 0, skills: [system-design, decomposition, planning, architecture, tradeoffs], riskLevel: medium
- `data_ml_engineer`: emoji 📊, color #14B8A6, priority 8, skills: [sql, etl, python, machine-learning, mlops, data-modeling], riskLevel: medium
- `mobile_developer`: emoji 📱, color #22C55E, priority 9, skills: [ios, android, swift, kotlin, react-native, mobile], riskLevel: medium

Update `backend_developer` keywords to include absorbed patterns.

### Step 2: Create migration

Create `api/src/db/migrations/<timestamp>-ConsolidatePersonas.ts` that:
1. Creates new system personas: `architect`, `data_ml_engineer`, `mobile_developer`
2. Remaps existing task references: UPDATE worker_tasks SET worker_persona = 'backend_developer' WHERE worker_persona IN ('api_developer', 'database_administrator')
3. Remaps: UPDATE worker_tasks SET worker_persona = 'data_ml_engineer' WHERE worker_persona IN ('data_engineer', 'ml_engineer')
4. Remaps: UPDATE worker_tasks SET worker_persona = 'mobile_developer' WHERE worker_persona IN ('mobile_developer_android', 'mobile_developer_ios')
5. Soft-deletes old system personas (set isActive = false or equivalent)
6. Uses IF EXISTS guards for idempotency

**DO NOT drop old persona rows** — they may have foreign key references from historical tasks.

### Step 3: Register migration in `api/src/db/connection.ts`

### Step 4: Commit

```bash
git add api/src/db/seeds/seed-personas.ts api/src/db/migrations/ api/src/db/connection.ts
git commit -m "feat: seed data and migration for persona consolidation"
```

---

## Task 4: Update Worker Execution Code

**Files:**
- Modify: `worker/epic/experts.ts` — `DEFAULT_EXPERT_CONFIGS`
- Modify: `worker/epic/executor.ts` — `resolveTargetPersona()`
- Modify: `worker/epic/coordinator.ts` — `QUESTION_INELIGIBLE_PERSONAS`
- Modify: `worker/multi-expert/index.ts` — `getExpertConfigForPersona()`, `normalizePersonaName()`
- Modify: `worker/agents/ai-sdk-executor.js` — `PERSONA_EMOJIS`

### Step 1: Update `worker/epic/experts.ts`

Remove expert configs for `api_developer`, `database_administrator`, `data_engineer`, `ml_engineer`, `mobile_developer_android`, `mobile_developer_ios`.

Add configs for `architect`, `data_ml_engineer`, `mobile_developer` with appropriate systemPrompt, tools, and specialties.

Enhance `backend_developer` config to include specialties from api_developer and database_administrator.

### Step 2: Update `worker/epic/executor.ts` — `resolveTargetPersona()`

Remap short hints:
```typescript
API: "backend_developer",
DATABASE: "backend_developer",
DBA: "backend_developer",
ML: "data_ml_engineer",
DATA: "data_ml_engineer",
IOS: "mobile_developer",
ANDROID: "mobile_developer",
ARCHITECT: "architect",
MOBILE: "mobile_developer",
```

### Step 3: Update `worker/epic/coordinator.ts`

Update `QUESTION_INELIGIBLE_PERSONAS` — remove `ml_engineer`, keep `support_agent`, `project_manager`, `tech_writer`.

### Step 4: Update `worker/multi-expert/index.ts`

Update `getExpertConfigForPersona()` and `normalizePersonaName()` with same remapping.

### Step 5: Update `worker/agents/ai-sdk-executor.js`

Update `PERSONA_EMOJIS` — remove old, add `architect: "🏗️"`, `data_ml_engineer: "📊"`, `mobile_developer: "📱"`.

### Step 6: Commit

```bash
git add worker/epic/ worker/multi-expert/ worker/agents/
git commit -m "feat: update worker execution code for persona consolidation"
```

---

## Task 5: Update Planning Prompts & Decision Engine

**Files:**
- Modify: `api/src/services/critic-agent.ts` — persona list in prompt
- Modify: `api/src/services/build-planner.ts` — persona table in prompt
- Modify: `api/src/services/planning-agent-local.ts` — fallback persona list
- Modify: `api/src/services/planning-agent/planner-v1.ts` — persona table
- Modify: `api/src/services/worker-decision-engine.ts` — PERSONA_ICONS, KEYWORD_SPECIALTY
- Modify: `api/src/services/planning-validation.ts` — PERSONA_REMAP
- Modify: `api/src/services/planning-themes.ts` — persona assignments

### Step 1: Update all planning prompt persona tables

In each planner file, replace the persona table/list with the consolidated set of 12. Remove references to removed personas. Add `architect` to the list.

### Step 2: Update `worker-decision-engine.ts`

- Update `PERSONA_ICONS` — remove old, add new
- Update `QUESTION_INELIGIBLE_PERSONAS` — remove `ml_engineer`
- Update `KEYWORD_SPECIALTY` — remap `database_administrator` → `backend_developer`, `api_developer` → `backend_developer`

### Step 3: Update `planning-validation.ts`

Update `PERSONA_REMAP`:
```typescript
mobile_developer: "mobile_developer",
mobile: "mobile_developer",
dba: "backend_developer",
database_administrator: "backend_developer",
api_developer: "backend_developer",
data_engineer: "data_ml_engineer",
ml_engineer: "data_ml_engineer",
mobile_developer_android: "mobile_developer",
mobile_developer_ios: "mobile_developer",
```

### Step 4: Commit

```bash
git add api/src/services/
git commit -m "feat: update planning prompts and decision engine for persona consolidation"
```

---

## Task 6: Update API Routes & Settings

**Files:**
- Modify: `api/src/routes/settings/general.ts` — `validPersonas` array
- Modify: `api/src/services/persona-inference.ts` — `getPersonaDisplayName()`, `PERSONA_KEYWORDS` (lower section)

### Step 1: Update `api/src/routes/settings/general.ts`

Replace `validPersonas` array (line ~451) with consolidated list plus "auto".

### Step 2: Update display name mapping in persona-inference.ts

Update `getPersonaDisplayName()` to handle new personas and remove old ones.

### Step 3: Commit

```bash
git add api/src/routes/settings/ api/src/services/persona-inference.ts
git commit -m "feat: update API routes and settings for persona consolidation"
```

---

## Task 7: Update Frontend Components

**Files:**
- Modify: `frontend/src/hooks/usePersonas.ts` — FALLBACK_PERSONAS
- Modify: `frontend/src/pages/Dashboard/types.ts` — PERSONA_CONFIG
- Modify: `frontend/src/components/CoordinationFeed.tsx` — PERSONA_CONFIGS
- Modify: `frontend/src/components/BuildTerminal.tsx` — PERSONA_LABELS
- Modify: `frontend/src/pages/Dashboard/EmbeddedCommunicationsFeed.tsx` — COMMS_PERSONA_CONFIGS
- Modify: `frontend/src/pages/Home/Workers.tsx` — workerPersonas array
- Modify: `frontend/src/pages/Docs/Personas.tsx` — persona cards
- Modify: `frontend/src/pages/Docs/PersonaStudio.tsx` — system persona list
- Modify: `frontend/src/pages/ShowcaseViewer.tsx` — personaLabels
- Modify: `frontend/src/pages/settings/types.ts` — PERSONA_OPTIONS

### Step 1: Update each file

For each file: remove entries for the 6 deleted personas, add entries for `architect`, `mobile_developer`, `data_ml_engineer` with appropriate emoji, labels, skills, colors.

### Step 2: Commit

```bash
git add frontend/src/
git commit -m "feat: update frontend components for persona consolidation"
```

---

## Task 8: Update Showcase Data

**Files:**
- Modify: `api/src/config/cached-plans.ts` — replace `api_developer` references
- Modify: `frontend/src/data/calmill-showcase-data.ts` — replace persona references
- Modify: `frontend/src/data/taskpulse-showcase-data.ts` — replace persona references
- Modify: `frontend/src/data/teamboard-showcase-data.ts` — replace persona references

### Step 1: Replace all old persona slugs with their consolidation targets

`api_developer` → `backend_developer`, `database_administrator` → `backend_developer`, etc.

### Step 2: Commit

```bash
git add api/src/config/ frontend/src/data/
git commit -m "feat: update showcase data for persona consolidation"
```

---

## Task 9: Update VS Code Extension

**Files:**
- Modify: `packages/vscode-workermill/src/mission-control-panel.ts` — personaEmoji
- Modify: `packages/vscode-workermill/src/feed-view.ts` — personaEmoji
- Modify: `packages/vscode-workermill/src/team-tree.ts` — personaIcon

### Step 1: Update each file

Remove old persona entries, add `architect: "🏗️"`, `mobile_developer: "📱"`, `data_ml_engineer: "📊"`.

### Step 2: Commit

```bash
git add packages/vscode-workermill/src/
git commit -m "feat: update VS Code extension for persona consolidation"
```

---

## Task 10: Update Tests

**Files:**
- Modify: `api/src/services/worker-decision-engine.test.ts` — update test assertions

### Step 1: Update test expectations

Replace references to `database_administrator`, `api_developer`, `ml_engineer` with their consolidated targets.

### Step 2: Run tests to verify

```bash
cd api && npm run test
cd api && npm run typecheck
cd frontend && npx tsc -b
```

### Step 3: Commit

```bash
git add api/src/services/worker-decision-engine.test.ts
git commit -m "test: update decision engine tests for persona consolidation"
```

---

## Task 11: Remove Old Directive Directories

**Files:**
- Remove: `worker/directives/api_developer/`
- Remove: `worker/directives/database_administrator/`
- Remove: `worker/directives/data_engineer/`
- Remove: `worker/directives/ml_engineer/`
- Remove: `worker/directives/mobile_developer_android/`
- Remove: `worker/directives/mobile_developer_ios/`

### Step 1: Delete directories

```bash
rm -rf worker/directives/api_developer/
rm -rf worker/directives/database_administrator/
rm -rf worker/directives/data_engineer/
rm -rf worker/directives/ml_engineer/
rm -rf worker/directives/mobile_developer_android/
rm -rf worker/directives/mobile_developer_ios/
```

### Step 2: Commit

```bash
git add -A worker/directives/
git commit -m "chore: remove old persona directive directories"
```

---

## Task 12: Final Verification

### Step 1: Type check everything

```bash
cd api && npm run typecheck
cd frontend && npx tsc -b
cd agent && npm run typecheck
cd packages/vscode-workermill && npm run typecheck
```

### Step 2: Run API tests

```bash
cd api && npm run test
```

### Step 3: Grep for orphaned references

```bash
# Search for any remaining references to removed persona slugs
grep -r "api_developer\|database_administrator\|data_engineer\b\|ml_engineer\|mobile_developer_android\|mobile_developer_ios" \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=migrations \
  api/ frontend/ worker/ agent/ packages/
```

Any hits (outside migrations, which are immutable) need fixing.

### Step 4: Lint check

```bash
cd api && npm run lint
cd frontend && npm run lint
```

### Step 5: Final commit (if any fixes needed)

---

## Rebuild/Restart Requirements

After all changes:
- **API**: auto-reloads via `tsx watch` — no action needed
- **Frontend**: auto-reloads via Vite HMR — no action needed
- **Worker image**: `./bin/local-workermill build-worker` (directives are baked into Docker image)
- **Agent binary**: `cd agent && npm run build && npm link` + restart agent (if agent code changed)
- **VS Code extension**: `cd packages/vscode-workermill && npm run build && npm run package` + install + reload VS Code
- **Database**: Run the migration (automatic on API restart)
