# Severity Levels

WorkerMill uses a P1–P5 priority system to control queue order and response expectations. Set the priority on your ticket or task to control how urgently workers respond.

## Priority Levels

### P1 — Critical

Production is down or severely impacted. Requires immediate attention.

**Response target:** < 15 minutes  
**Resolution target:** < 4 hours

**Examples:**
- Complete service outage
- Data breach or security incident
- Revenue-impacting bug in production
- All users affected

**Worker behavior:** Highest queue priority. May interrupt other tasks.

---

### P2 — High

Major functionality broken. Significant user impact but workarounds exist.

**Response target:** < 1 hour  
**Resolution target:** < 8 hours

**Examples:**
- Key feature not working
- Performance severely degraded
- Many users affected
- Blocking release

**Worker behavior:** High queue priority. Processed before P3–P5.

---

### P3 — Medium

Standard priority for planned development work and non-urgent bugs.

**Response target:** < 4 hours  
**Resolution target:** < 24 hours

**Examples:**
- New feature implementation
- Minor bugs with workarounds
- Enhancements to existing features
- Non-critical integrations

**Worker behavior:** Normal queue priority. FIFO among same priority.

---

### P4 — Low

Nice-to-have improvements. Can be addressed when capacity allows.

**Response target:** < 24 hours  
**Resolution target:** < 1 week

**Examples:**
- UI polish and improvements
- Documentation updates
- Minor optimizations
- Technical debt reduction

**Worker behavior:** Lower queue priority. May wait for higher priority work.

---

### P5 — Trivial

Backlog items with no urgency. Addressed opportunistically.

**Response target:** Best effort  
**Resolution target:** When capacity allows

**Examples:**
- Cosmetic fixes
- Exploratory research
- Long-term refactoring
- "Nice to have" features

**Worker behavior:** Lowest queue priority. Only processed when no higher priority work exists.

---

## Setting Priority

**From your issue tracker:**
Add labels to your Jira, Linear, or GitHub issues:
- `priority:p1` through `priority:p5`
- Or use your existing priority field if configured in Settings

**From the dashboard:**
Set priority when creating a task manually, or edit the priority on any existing task.

**From the API:**
```json
{
  "priority": "p1"
}
```

## Priority and Queue

The orchestrator processes tasks in priority order within each execution mode. A P1 task arriving while P3 tasks are queued will skip ahead.

Note: P1 tasks do not preempt currently executing tasks — they jump to the front of the queue for the next available worker slot.
