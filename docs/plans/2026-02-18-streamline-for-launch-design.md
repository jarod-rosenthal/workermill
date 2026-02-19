# Streamline WorkerMill for Launch

**Date:** 2026-02-18
**Status:** Approved

## Context

WorkerMill is preparing to go live. The codebase has accumulated features that add noise without delivering validated value: 12 mock role-based dashboards, a compliance center built before enterprise customers exist, and a competitive comparison table on the landing page that risks looking defensive. This design strips the noise so the product presents a focused, credible experience.

**Constraint:** The platform tenant (WorkerMill's own org) must retain full access to all features as a development testbed.

## Changes

### 1. Remove `/views` (Role-Based Dashboards)

The 12 role-based views (Engineer, Manager, CTO, Finance, HR, Security, QA, Tech Lead, Product Manager, DevOps, Sales, Marketing) all use hardcoded mock data (`useState(mockData)` with no API calls). They are not linked from the main dashboard nav.

- Delete the `/views` route from `App.tsx`
- Remove the `RoleBasedDashboard` import from `App.tsx`
- Delete all view component files from `pages/Dashboard/` (EngineerView, ManagerView, CTOView, FinanceView, HRView, SecurityView, QAView, TechLeadView, ProductManagerView, DevOpsView, SalesView, MarketingView)
- Remove the `RoleBasedDashboard` export from `pages/Dashboard/index.ts`
- No platform-tenant exception needed — these were entirely mock data

### 2. Gate `/compliance` Behind Enterprise Plan

- In `App.tsx`, conditionally render the `/compliance` route only when `organization.plan === 'enterprise'`
- Remove any nav links to `/compliance` for non-enterprise orgs
- The platform org has `plan: 'enterprise'`, retaining full access

### 3. Add "Beta" Badges to Insights Dropdown

In `MainDashboard.tsx`, add a "Beta" pill badge next to four Insights dropdown items:
- Cost Intelligence (`/cost-intelligence`)
- Memory (`/memory`)
- Skills (`/skills`)
- Directive Effectiveness (`/directive-effectiveness`)

Analytics (`/analytics`) remains unbadged.

Badge style: `text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full`

### 4. Remove CompetitiveComparison from Landing Page

- Remove the `<CompetitiveComparison />` render and import from `LandingV0.tsx`
- Keep the component file for potential future use

## What Stays Unchanged

- All remaining routes stay functional
- Dashboard core: Run Task, Active Workflows, terminal streaming, boards, personas, settings, billing, analytics
- Landing page: Hero, BuildTerminal, Showcase, Stats, FeaturesGrid, AgentCollaboration, HowItWorks, Workers, Features, Pricing
