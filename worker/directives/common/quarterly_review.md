# Quarterly Directive Review

> Scheduled review of all directives to ensure currency and effectiveness.

## Goal

Maintain directive quality through regular reviews. This ensures:
- Directives stay accurate as the codebase evolves
- Learned improvements are properly integrated
- Obsolete content is archived
- Gaps are identified and filled

## When to Run

- **Quarterly**: Full review of all directives
- **Monthly**: Quick review of high-activity directives
- **Ad-hoc**: After major codebase changes

## Review Process

### Phase 1: Directive Accuracy

For each directive file in `directives/`:

#### Accuracy Checklist
- [ ] **Steps match reality** - Do the documented steps still work?
- [ ] **Tools exist** - Do referenced scripts/tools still exist?
- [ ] **Paths are correct** - Are file paths still valid?
- [ ] **Examples compile** - Do code examples still work?
- [ ] **Patterns are current** - Do patterns match current codebase style?

#### Common Issues to Check
- Renamed files/directories not updated in examples
- Deprecated APIs still referenced
- New team conventions not reflected
- Security practices outdated

### Phase 2: Self-Annealing Notes Review

For each directive with Self-Annealing Notes:

#### Notes Checklist
- [ ] **Notes are actionable** - Do notes provide clear guidance?
- [ ] **Issues are resolved** - Have noted issues been fixed?
- [ ] **Archive resolved items** - Move fixed issues to archive section
- [ ] **Promote patterns** - Upgrade valuable learnings to main directive

#### Note Categories
| Category | Action |
|----------|--------|
| Temporary workaround | Check if proper fix exists now |
| Learned pattern | Consider promoting to main steps |
| Known issue | Check if resolved |
| Edge case | Verify still relevant |

### Phase 3: Execution Scripts Review

For each script in `execution/`:

#### Script Checklist
- [ ] **Script runs** - Does it execute without errors?
- [ ] **Output is valid** - Is JSON output well-formed?
- [ ] **Error handling works** - Do errors produce useful messages?
- [ ] **Dependencies current** - Are all dependencies up to date?

#### Script Quality Checks
- Consistent error message format
- Proper exit codes
- Environment variable documentation
- Input validation

### Phase 4: Persona Coverage Review

For each persona in `directives/`:

#### Coverage Checklist
- [ ] **Common tasks documented** - Are typical tasks covered?
- [ ] **Patterns are current** - Do examples reflect current code?
- [ ] **Security guidance present** - Are security practices documented?
- [ ] **Edge cases covered** - Are common problems addressed?

#### Gap Identification
- List tasks this persona commonly does
- Check if each task has a directive
- Note missing directives for creation

### Phase 5: Metrics Review

Analyze MTTA/MTTR trends from the past quarter:

#### Metrics Questions
- Which task types are slowest?
- Which directives have most failures?
- What common blockers exist?
- Which personas need more support?

#### Trend Analysis
```
Gather metrics for:
- Average resolution time by task type
- Failure rate by directive
- Escalation frequency by persona
- Self-annealing activity
```

## Output Actions

### 1. Update Directives

Make necessary corrections:
```bash
# Create review branch
git checkout -b review/quarterly-$(date +%Y-Q$((($(date +%-m)-1)/3+1)))

# Make edits to directive files
# ...

# Commit with clear message
git commit -m "docs: quarterly directive review Q[N] [YEAR]"
```

### 2. Archive Obsolete Content

Move outdated items to archive:
```markdown
## Archive

### [Date] - Archived from Self-Annealing Notes
[Content that is no longer relevant]
```

### 3. Create Improvement Tickets

For identified gaps:
```bash
TITLE="[DIRECTIVE] Add directive for [task type]" \
DESCRIPTION="Quarterly review identified missing coverage for..." \
LABELS="directive,improvement" \
node /app/execution-compiled/ticket/create_issue.js
```

### 4. Update Metrics Dashboard

Record review completion:
```bash
REVIEW_TYPE="quarterly" \
DIRECTIVES_REVIEWED=X \
ISSUES_FOUND=Y \
IMPROVEMENTS_MADE=Z \
node /app/execution-compiled/metrics/record_review_cycle.js
```

## Review Report Template

Create a summary report after each quarterly review:

```markdown
# Quarterly Directive Review Report - Q[N] [YEAR]

## Summary
- **Directives reviewed:** X
- **Scripts reviewed:** Y
- **Issues found:** Z
- **Improvements made:** W

## Key Findings

### Accuracy Issues
1. [Issue]: [Resolution]
2. ...

### Coverage Gaps
1. [Missing directive]: [Priority]
2. ...

### Performance Insights
- Slowest task type: [type] (avg X min)
- Most failed directive: [directive] (Y failures)
- Common blocker: [issue]

## Actions Taken
- Updated [list of directives]
- Archived [list of obsolete items]
- Created tickets: [list of ticket IDs]

## Recommendations for Next Quarter
1. [Recommendation]
2. ...
```

## Scheduling

### Quarterly Review (Full)
- **Duration:** 2-4 hours
- **Scope:** All directives, all scripts, all personas
- **Output:** Full report + updates

### Monthly Review (Quick)
- **Duration:** 30-60 minutes
- **Scope:** High-activity directives only
- **Output:** Quick fixes + notes for quarterly

### Ad-hoc Review (Triggered)
- **Trigger:** Major refactoring, new feature area, repeated failures
- **Scope:** Affected directives only
- **Output:** Targeted updates

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
