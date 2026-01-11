***REMOVED*** Quarterly Directive Review

> Scheduled review of all directives to ensure currency and effectiveness.

***REMOVED******REMOVED*** Goal

Maintain directive quality through regular reviews. This ensures:
- Directives stay accurate as the codebase evolves
- Learned improvements are properly integrated
- Obsolete content is archived
- Gaps are identified and filled

***REMOVED******REMOVED*** When to Run

- **Quarterly**: Full review of all directives
- **Monthly**: Quick review of high-activity directives
- **Ad-hoc**: After major codebase changes

***REMOVED******REMOVED*** Review Process

***REMOVED******REMOVED******REMOVED*** Phase 1: Directive Accuracy

For each directive file in `directives/`:

***REMOVED******REMOVED******REMOVED******REMOVED*** Accuracy Checklist
- [ ] **Steps match reality** - Do the documented steps still work?
- [ ] **Tools exist** - Do referenced scripts/tools still exist?
- [ ] **Paths are correct** - Are file paths still valid?
- [ ] **Examples compile** - Do code examples still work?
- [ ] **Patterns are current** - Do patterns match current codebase style?

***REMOVED******REMOVED******REMOVED******REMOVED*** Common Issues to Check
- Renamed files/directories not updated in examples
- Deprecated APIs still referenced
- New team conventions not reflected
- Security practices outdated

***REMOVED******REMOVED******REMOVED*** Phase 2: Self-Annealing Notes Review

For each directive with Self-Annealing Notes:

***REMOVED******REMOVED******REMOVED******REMOVED*** Notes Checklist
- [ ] **Notes are actionable** - Do notes provide clear guidance?
- [ ] **Issues are resolved** - Have noted issues been fixed?
- [ ] **Archive resolved items** - Move fixed issues to archive section
- [ ] **Promote patterns** - Upgrade valuable learnings to main directive

***REMOVED******REMOVED******REMOVED******REMOVED*** Note Categories
| Category | Action |
|----------|--------|
| Temporary workaround | Check if proper fix exists now |
| Learned pattern | Consider promoting to main steps |
| Known issue | Check if resolved |
| Edge case | Verify still relevant |

***REMOVED******REMOVED******REMOVED*** Phase 3: Execution Scripts Review

For each script in `execution/`:

***REMOVED******REMOVED******REMOVED******REMOVED*** Script Checklist
- [ ] **Script runs** - Does it execute without errors?
- [ ] **Output is valid** - Is JSON output well-formed?
- [ ] **Error handling works** - Do errors produce useful messages?
- [ ] **Dependencies current** - Are all dependencies up to date?

***REMOVED******REMOVED******REMOVED******REMOVED*** Script Quality Checks
- Consistent error message format
- Proper exit codes
- Environment variable documentation
- Input validation

***REMOVED******REMOVED******REMOVED*** Phase 4: Persona Coverage Review

For each persona in `directives/`:

***REMOVED******REMOVED******REMOVED******REMOVED*** Coverage Checklist
- [ ] **Common tasks documented** - Are typical tasks covered?
- [ ] **Patterns are current** - Do examples reflect current code?
- [ ] **Security guidance present** - Are security practices documented?
- [ ] **Edge cases covered** - Are common problems addressed?

***REMOVED******REMOVED******REMOVED******REMOVED*** Gap Identification
- List tasks this persona commonly does
- Check if each task has a directive
- Note missing directives for creation

***REMOVED******REMOVED******REMOVED*** Phase 5: Metrics Review

Analyze MTTA/MTTR trends from the past quarter:

***REMOVED******REMOVED******REMOVED******REMOVED*** Metrics Questions
- Which task types are slowest?
- Which directives have most failures?
- What common blockers exist?
- Which personas need more support?

***REMOVED******REMOVED******REMOVED******REMOVED*** Trend Analysis
```
Gather metrics for:
- Average resolution time by task type
- Failure rate by directive
- Escalation frequency by persona
- Self-annealing activity
```

***REMOVED******REMOVED*** Output Actions

***REMOVED******REMOVED******REMOVED*** 1. Update Directives

Make necessary corrections:
```bash
***REMOVED*** Create review branch
git checkout -b review/quarterly-$(date +%Y-Q$((($(date +%-m)-1)/3+1)))

***REMOVED*** Make edits to directive files
***REMOVED*** ...

***REMOVED*** Commit with clear message
git commit -m "docs: quarterly directive review Q[N] [YEAR]"
```

***REMOVED******REMOVED******REMOVED*** 2. Archive Obsolete Content

Move outdated items to archive:
```markdown
***REMOVED******REMOVED*** Archive

***REMOVED******REMOVED******REMOVED*** [Date] - Archived from Self-Annealing Notes
[Content that is no longer relevant]
```

***REMOVED******REMOVED******REMOVED*** 3. Create Improvement Tickets

For identified gaps:
```bash
TITLE="[DIRECTIVE] Add directive for [task type]" \
DESCRIPTION="Quarterly review identified missing coverage for..." \
LABELS="directive,improvement" \
node /app/execution-compiled/ticket/create_issue.js
```

***REMOVED******REMOVED******REMOVED*** 4. Update Metrics Dashboard

Record review completion:
```bash
REVIEW_TYPE="quarterly" \
DIRECTIVES_REVIEWED=X \
ISSUES_FOUND=Y \
IMPROVEMENTS_MADE=Z \
node /app/execution-compiled/metrics/record_review_cycle.js
```

***REMOVED******REMOVED*** Review Report Template

Create a summary report after each quarterly review:

```markdown
***REMOVED*** Quarterly Directive Review Report - Q[N] [YEAR]

***REMOVED******REMOVED*** Summary
- **Directives reviewed:** X
- **Scripts reviewed:** Y
- **Issues found:** Z
- **Improvements made:** W

***REMOVED******REMOVED*** Key Findings

***REMOVED******REMOVED******REMOVED*** Accuracy Issues
1. [Issue]: [Resolution]
2. ...

***REMOVED******REMOVED******REMOVED*** Coverage Gaps
1. [Missing directive]: [Priority]
2. ...

***REMOVED******REMOVED******REMOVED*** Performance Insights
- Slowest task type: [type] (avg X min)
- Most failed directive: [directive] (Y failures)
- Common blocker: [issue]

***REMOVED******REMOVED*** Actions Taken
- Updated [list of directives]
- Archived [list of obsolete items]
- Created tickets: [list of ticket IDs]

***REMOVED******REMOVED*** Recommendations for Next Quarter
1. [Recommendation]
2. ...
```

***REMOVED******REMOVED*** Scheduling

***REMOVED******REMOVED******REMOVED*** Quarterly Review (Full)
- **Duration:** 2-4 hours
- **Scope:** All directives, all scripts, all personas
- **Output:** Full report + updates

***REMOVED******REMOVED******REMOVED*** Monthly Review (Quick)
- **Duration:** 30-60 minutes
- **Scope:** High-activity directives only
- **Output:** Quick fixes + notes for quarterly

***REMOVED******REMOVED******REMOVED*** Ad-hoc Review (Triggered)
- **Trigger:** Major refactoring, new feature area, repeated failures
- **Scope:** Affected directives only
- **Output:** Targeted updates

***REMOVED******REMOVED*** Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
