# WorkerMill Search Box Polish Plan

## Summary

The search implementation is **production-ready**, not placeholder code. It uses PostgreSQL full-text search with proper ranking, filtering, and pagination. This plan addresses 10 identified UX gaps through 3 phases.

## Current State

**What exists and works:**
- Full modal search dialog (`LogSearch.tsx`) with filters for type/severity
- PostgreSQL full-text search using `plainto_tsquery()` + `ts_rank()` for relevance
- Search vector maintained by database trigger with weighted fields (message > command > stdout)
- Results show: Jira key, task summary, 200-char snippet, timestamp, file path
- Pagination with "Load more"

**What's missing (UX gaps):**
1. No keyboard shortcut (Cmd/Ctrl+K)
2. Search only searches logs, not tasks themselves
3. No search result highlighting
4. No real-time/debounced search (must click Search button)
5. Filter changes don't auto-trigger search
6. Load more replaces results instead of appending (bug)
7. No Escape key to close modal
8. No clear/reset functionality
9. No search history

---

## Task Checklist

### Phase 1: Quick Wins

- [ ] **1.1 Add Cmd/Ctrl+K keyboard shortcut**
  - File: `frontend/src/pages/Dashboard.tsx`
  - Add useEffect with keydown listener for meta/ctrl + k
  - Call `setIsLogSearchOpen(true)` when triggered

- [ ] **1.2 Add Escape key to close modal**
  - File: `frontend/src/components/LogSearch.tsx`
  - Add useEffect with keydown listener for Escape
  - Call `onClose()` when triggered

- [ ] **1.3 Fix pagination "Load more" bug**
  - File: `frontend/src/components/LogSearch.tsx` (line 68)
  - Change `setResults(response.data.results)` to append logic
  - Use: `setResults(prev => offset === 0 ? response.data.results : [...prev, ...response.data.results])`

- [ ] **1.4 Add clear/reset button**
  - File: `frontend/src/components/LogSearch.tsx`
  - Add clear button next to search input
  - Handler resets query, results, pagination, and filters

### Phase 2: Debounced Search & Auto-Apply Filters

- [ ] **2.1 Create useDebounce hook**
  - New file: `frontend/src/hooks/useDebounce.ts`
  - Implement standard debounce hook with generics

- [ ] **2.2 Implement debounced search**
  - File: `frontend/src/components/LogSearch.tsx`
  - Import and use useDebounce for query (300ms delay)
  - Add useEffect to trigger search when debounced query changes

- [ ] **2.3 Auto-apply filters on change**
  - File: `frontend/src/components/LogSearch.tsx`
  - Include `filters` in the useEffect dependency array
  - Search re-executes when filters change (if query exists)

### Phase 3: Enhanced Capabilities

- [ ] **3.1 Add search result highlighting (backend)**
  - File: `api/src/routes/control-center.ts` (around line 1794)
  - Add `ts_headline()` to generate highlighted snippets
  - Return `headline` field in response

- [ ] **3.2 Add search result highlighting (frontend)**
  - File: `frontend/src/components/LogSearch.tsx`
  - Render highlighted snippet using CSS class for mark tags
  - Safely handle HTML in snippets

- [ ] **3.3 Add task-level search (backend)**
  - File: `api/src/routes/control-center.ts`
  - Query `worker_tasks` table by jiraIssueKey (exact) and summary (ILIKE)
  - Return `tasks` array alongside `logs` in response

- [ ] **3.4 Add task-level search (frontend)**
  - File: `frontend/src/components/LogSearch.tsx`
  - Add tabs or sections: "Tasks" | "Logs"
  - Show task results with Jira key, summary, status badge, created date
  - Clicking task navigates to task detail page

- [ ] **3.5 Add search history**
  - File: `frontend/src/components/LogSearch.tsx`
  - Store last 5 queries in localStorage (`workermill_search_history`)
  - Show as chips below search input when query is empty
  - Click to populate and execute search

---

## Implementation Details

### Phase 1: Quick Wins

#### 1.1 Keyboard Shortcut

**File:** `frontend/src/pages/Dashboard.tsx`

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsLogSearchOpen(true);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

#### 1.2 Escape Key

**File:** `frontend/src/components/LogSearch.tsx`

```tsx
useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  if (isOpen) {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }
}, [isOpen, onClose]);
```

#### 1.3 Pagination Fix

**File:** `frontend/src/components/LogSearch.tsx` (line 68)

**Before:**
```tsx
setResults(response.data.results);
```

**After:**
```tsx
setResults(prev => offset === 0 ? response.data.results : [...prev, ...response.data.results]);
```

#### 1.4 Clear Button

**File:** `frontend/src/components/LogSearch.tsx`

```tsx
const handleClear = () => {
  setQuery("");
  setResults([]);
  setPagination(null);
  setFilters({});
};

// In JSX, add button after search input:
{query && (
  <button type="button" onClick={handleClear} className="px-3 py-2 text-muted-foreground hover:text-foreground">
    <X className="w-4 h-4" />
  </button>
)}
```

---

### Phase 2: Debounced Search

#### 2.1 useDebounce Hook

**New file:** `frontend/src/hooks/useDebounce.ts`

```tsx
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
```

#### 2.2-2.3 Debounced Search with Auto-Apply Filters

**File:** `frontend/src/components/LogSearch.tsx`

```tsx
import { useDebounce } from "../hooks/useDebounce";

// Inside component:
const debouncedQuery = useDebounce(query, 300);

useEffect(() => {
  if (debouncedQuery.trim()) {
    performSearch(debouncedQuery);
  } else {
    setResults([]);
    setPagination(null);
  }
}, [debouncedQuery, filters.type, filters.severity]);
```

---

### Phase 3: Enhanced Capabilities

#### 3.1-3.2 Search Result Highlighting

**File:** `api/src/routes/control-center.ts`

Add to query builder (around line 1794):
```typescript
queryBuilder = queryBuilder
  .addSelect(
    "ts_headline('english', log.message, plainto_tsquery('english', :query), 'MaxWords=50, MinWords=30, StartSel=<mark>, StopSel=</mark>')",
    "headline"
  )
```

Update response mapping:
```typescript
const results = logs.map((log, raw) => ({
  // ...existing fields
  headline: (log as any).headline || log.message.substring(0, 200),
}));
```

**File:** `frontend/src/components/LogSearch.tsx`

Add CSS for highlight and render:
```tsx
// Add to global CSS or inline styles
// .search-highlight mark { background-color: var(--mc-status-warning); border-radius: 2px; }

<div
  className="text-sm font-mono search-highlight"
  dangerouslySetInnerHTML={{ __html: result.headline || result.snippet }}
/>
```

#### 3.3-3.4 Task-Level Search

**File:** `api/src/routes/control-center.ts`

Add before returning response:
```typescript
// Task search
const taskResults = await taskRepo
  .createQueryBuilder("task")
  .where("task.orgId = :orgId", { orgId: org.id })
  .andWhere(
    "(task.jiraIssueKey ILIKE :query OR task.summary ILIKE :queryWild)",
    { query: searchQuery, queryWild: `%${searchQuery}%` }
  )
  .select(["task.id", "task.jiraIssueKey", "task.summary", "task.status", "task.createdAt"])
  .orderBy("task.createdAt", "DESC")
  .take(10)
  .getMany();

res.json({
  query: searchQuery,
  tasks: taskResults,  // NEW
  results,  // log results (renamed from 'results' in response)
  pagination: { ... },
});
```

**File:** `frontend/src/components/LogSearch.tsx`

Add state for active tab and task results:
```tsx
const [activeTab, setActiveTab] = useState<'all' | 'tasks' | 'logs'>('all');
const [taskResults, setTaskResults] = useState<TaskResult[]>([]);
```

Add tabs UI and task results section.

#### 3.5 Search History

**File:** `frontend/src/components/LogSearch.tsx`

```tsx
const HISTORY_KEY = 'workermill_search_history';
const MAX_HISTORY = 5;

const [searchHistory, setSearchHistory] = useState<string[]>(() => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
});

const addToHistory = (q: string) => {
  const trimmed = q.trim();
  if (!trimmed) return;
  const updated = [trimmed, ...searchHistory.filter(h => h !== trimmed)].slice(0, MAX_HISTORY);
  setSearchHistory(updated);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
};

// Call addToHistory(query) when search is executed
// Show history chips when query is empty
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/pages/Dashboard.tsx` | Add Cmd/Ctrl+K keyboard shortcut |
| `frontend/src/components/LogSearch.tsx` | Escape key, pagination fix, clear button, debounced search, highlighting, task results, history |
| `frontend/src/hooks/useDebounce.ts` | New file - debounce hook |
| `api/src/routes/control-center.ts` | Highlighting (ts_headline) and task search |

---

## Verification

### Phase 1
1. Press Cmd/Ctrl+K on Dashboard - modal opens
2. Press Escape - modal closes
3. Search for something, click "Load more" - results append (not replace)
4. Click X/clear button - query, results, filters all reset

### Phase 2
5. Type query - results appear after 300ms without clicking Search
6. Change type filter while query exists - results update immediately
7. Change severity filter - results update immediately

### Phase 3
8. Search results show highlighted matches (yellow background on matched words)
9. Search for a Jira key - matching tasks appear in "Tasks" section
10. Search for keywords - matching tasks by summary appear
11. Execute searches, close modal, reopen - recent searches shown as chips
12. Click history chip - query populates and executes
