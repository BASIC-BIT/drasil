# Workspace Entry Points and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed workspace accessible through reliable selected-server reads and carry its approved visual foundation through website entry points and directly linked admin destinations.

**Architecture:** Reuse one fresh Discord authority implementation, with a narrow live OAuth identity check and the existing owner/Administrator/Manage Server web gate. Represent expected access/dependency failures explicitly before reading records. Reuse Foundation, DrasilBrand and WorkspaceShell for presentation without changing existing moderation forms or policies.

**Tech Stack:** Existing Next.js, React, TypeScript, contracts/application packages, Vitest and production-build Playwright fixtures. No dependencies or database changes.

**Spec:** `docs/superpowers/specs/2026-10-23-moderation-workspace-design.md`, `docs/design/operator-copy.md`, issue #278 and the user's report that the deployed website still shows old UI and the inbox fails.

## Global Constraints

- Existing moderation rules, stored records and Discord effects remain authoritative.
- The existing owner / Administrator / ManageGuild website gate remains; staff-role-only and ModerateMembers-only identities do not gain web admission.
- Require locally valid session/token, live OAuth identity and exact session user binding, fresh selected guild/member/role facts, presence and exact guild/user binding before workspace adapters or records.
- Do not cache grants across requests, fall back to stale permissions, expose provider payloads or publicize private server identities.
- Retain AuthorityPort.loadFresh signature and behavior for application/MCP/mutation callers. No backend, schema or permission-policy rewrite.
- Keep genuine missing case/report/item404 after successful authorization distinct from denied access and unavailable verification.
- Every moderation mutation keeps its existing confirmation and eligibility. No auto-next, receipt loss or confirmation bypass.
- Reuse commissioned transparent logo, Manrope, flat neutral surfaces and restrained semantic colors. Existing public reporting/OAuth/security URLs remain.
- Preserve page loaders, forms, readiness routing and mutations during chrome adoption; no fabricated marketing capabilities.
- Production factories remain real. Tests use normal optimized builds, owned disposable Postgres and controlled external providers. No live moderation mutations or credential/session forging.

## Review Focus

- Revoked OAuth identity and fresh permission removal must stop reads despite older directory permissions. Task1 pins both.
- Provider404, denied access and unavailable reads must never become fabricated missing records or admitted users. Task1 pins the variants and retry recovery.
- Many OAuth servers must not be enumerated merely to read the already-selected server. Task1 blocks that endpoint and asserts zero calls.
- Returning from newly styled pages must preserve guild/account context and one main landmark. Task2 pins the complete navigation chain.
- Mobile menu, keyboard focus, dark theme and old forms must remain functional after shared chrome adoption. Task2 pins both viewport sizes/themes and existing functional cases.

## Task 1: Selected-server reads and actionable recovery

**Files:** Existing `lib/application/adapters/authority.ts`, `lib/workspaceRouteData.ts`, inbox-detail API and three page callers; new `lib/workspaceAccess.ts`, authority/access tests and shared failure UI; existing inbox detail error consumption; `lib/readDiagnostics.ts` only for a bounded selected-read operation; controlled provider fixture and built-browser regressions.

**Interfaces:** Extract `loadFreshGuildAuthority(guildId,userId)` in the authority module, returning the fresh metadata and actor or a tagged missing endpoint. Existing createWebAuthority remains its thin AuthorityPort projection. `loadWorkspaceAccess(guildId,session,token)` returns a discriminated ready/authentication_required/access_denied/unavailable result. Ready contains guild id/name and AuthorityFacts. Keep Next redirects outside dependency catches. Page loader redirects authentication-required as today and returns explicit access/unavailable states to callers. API uses401/403/503 stable safe codes, actual missing item404, sanitized unexpected500, private/no-store and bounded trusted Retry-After.

- [x] Write meaningful failing tests for OAuth identity/revocation, exact binding, fresh owner/Admin/ManageGuild matrix, no role-only admission, no adapters/DB on failure, provider source404/transient failures, actual authorized item404 and request-scoped refresh.
- [x] Run focused RED against current behavior and retain evidence. Distinguish Bearer actor and Bot identity in the controlled provider; current fixture incorrectly returns bot id for all users/@me calls. Do not change existing mutation setUnauthorized semantics to make new tests pass.
- [x] Implement one shared fresh authority loader plus narrow live fetchDiscordUser validation. Remove full OAuth guild enumeration only from the selected moderation read family. Model expected failure states and make page/API detail retry or access guidance accurate; denied refresh clears protected detail. Add sanitized scoped dependency diagnostics without provider text/identifiers. Unexpected errors remain distinguishable and sanitized.
- [x] Add real optimized-build regression with OAuth guild-list503 while narrow identity and selected authority succeed: inbox/case/report and detail API work with zero enumeration calls. Cover fresh permission loss, failed identity, selected member/guild/roles failures, retry recovery and real record404.
- [x] Run focused unit, relevant AuthorityPort consumer suites, web types/lint/production graph/build and built workspace tests serially against the owned DB. Report limits; do not claim authenticated production reproduction.
- [x] Commit `[AGENT] Repair selected workspace access and recovery states`; independent task review follows.

## Task 2: Coherent website entry and admin chrome

**Files:** `app/page.tsx`, `app/admin/page.tsx`, `components/cases/CaseHistoryView.tsx`, `components/operations/OperationsView.tsx`, `components/members/MemberProfileView.tsx`, setup/onboarding pages and `components/OnboardingWizard.tsx`; shared PublicShell and scoped content helpers/styles under components/workspace; public report, CAPTCHA and MCP React entry chrome; app/not-found.tsx and app/admin/error.tsx; affected tests and visual references.

**Interfaces:** Use a shared PublicShell with Foundation/DrasilBrand without guild context on home/server picker and adjacent public flows. PublicShell owns no main landmark; each public entry retains its main. Do not add Foundation to root or MCP layouts. Preserve public authentication and saved-confirmation contracts. Use WorkspaceShell with existing page identity on History, Operations, member history, Settings and Onboarding. Member history belongs to History; Onboarding belongs to Settings. Reuse Task1's failure presentation if needed but do not change those destinations' authentication/loaders just to restyle them.

- [x] Add failing built navigation/landmark/brand/mobile-menu checks for home -> server picker -> Inbox -> History/Settings/Operations -> member history -> Switch server. Preserve guild/account identity, one main landmark, correct active destination and existing links.
- [x] Replace old inline outer shells only, remove duplicate account/theme/server menus and use a scoped flat-content style bridge for legacy interiors. Keep forms, request tracking, actions and data intact. Home CTA is `Open moderation workspace`; use a short shared-protection/moderation introduction with existing factual reporting/settings links. No new marketing claims or sample product data.
- [x] Preserve cases/reports redirects and readiness-sensitive setup/onboarding routes. Add Inbox after successful onboarding while retaining Full settings.
- [x] Apply the same PublicShell once per public report list/form, CAPTCHA state, MCP ConnectionPanel and confirmation login/review/fallback, without changing content, fields, hidden inputs, formActions, receipts, effects or authentication. Remove duplicate chrome and locally bridge old palette/shadows; no root-wide overrides. Add shared-shell Storybook variants and branded genuine404/unexpected admin-read recovery.
- [x] Verify dark/light at390/1440 plus320px overflow, correct transparent logo, theme persistence and keyboard menu/focus. Update only intended affected snapshots after inspecting images. Keep existing workspace/case visuals and functional assertions unless a deliberate shared-shell change requires review.
- [x] Run relevant unit/functional/visual checks and normal optimized build journeys, then commit `[AGENT] Unify website entry points and workspace navigation`; independent task review follows.

## Finish

- [ ] Independent whole-change review against this plan and original visual/security constraints, with a bounded fix/re-review cycle for actual findings.
- [ ] Publish issue-linked PR, inspect/recycle actual reviews, complete required CI and final delayed-review sweep. No direct push to main.
- [ ] Report concrete merge/deployment state and authenticated-production verification limits. Existing production approval constraints remain; user has authorized fixing the deployment but the integration cannot approve GitHub protected deployments itself.
