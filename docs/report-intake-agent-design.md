# Report Intake Agent Design

This document defines the planned agentic report intake flow for #87. It builds
on the report intake thread surface from PR #96 and keeps the larger
LangGraph/VLM workflow separate from the simpler `/report`, `Report User`, and
`Report Message` paths.

## Goals

- Let a reporter start without knowing the exact Discord user to report.
- Collect screenshots, copied text, message links, natural language context, and
  follow-up answers into one durable intake.
- Use VLM/OCR extraction to turn screenshots into structured, untrusted evidence.
- Use deterministic tools to search candidate members, case history, and policy.
- Require confirmation before attaching screenshot or nickname-only evidence to a
  Discord user.
- Route confirmed reports into the existing `USER_REPORT` detection event,
  observed alert, and case workflow.
- Never auto-ban from this flow.

## Non-Goals

- Training on Discord message content, screenshots, or reporter evidence.
- Broad cross-server identity search before #43 defines privacy policy and opt-in.
- Silent identity selection from screenshots, nicknames, or display names.
- Replacing the existing target-specific `/report`, `Report User`, or
  `Report Message` flows.
- Making Discord controllers or LangGraph nodes call repositories directly.

## Prior Art

`BASIC-BIT/discord-time-app` has the strongest local LangGraph prior art:

- `api/src/temporal/graph.ts` uses `StateGraph`, `MessagesAnnotation`,
  `ToolNode`, Zod tool schemas, `model.bindTools(...)`, explicit stop
  conditions, tool-call budgets, and trace metadata.
- `docs/temporal-coalescing-v1.md` keeps deterministic implementations separate
  from LangGraph tool adapters, exposes finalization only after candidate facts
  exist, and treats clarification as a first-class outcome.

Apply the same shape here:

- Deterministic preflight before LLM work.
- Small tool set with Zod schemas.
- Bounded graph loop.
- Explicit confirmation/finalization gates.
- Structured trace output for moderator/debug visibility.
- Shared application services below Discord, LangGraph, MCP, and future web
  adapters, as planned in #89.

## Current Entry Surface

PR #96 changes the report instructions button into a private report intake
thread:

1. Reporter clicks the report button in the configured report channel.
2. Drasil opens a private thread and adds the reporter.
3. Drasil adds configured case responders when member routing is enabled.
4. Drasil posts guidance asking for freeform report context.
5. Drasil notifies the admin channel with the thread link.

That thread is only the collection surface. The full #87 workflow needs durable
state, evidence records, and an agent loop.

## Durable State

Add `report_intakes`.

Suggested fields:

```text
id uuid primary key
server_id text not null
reporter_id text not null
thread_id text unique
status report_intake_status not null
summary text null
confirmed_target_user_id text null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
closed_at timestamptz null
metadata jsonb not null default '{}'
```

Suggested statuses:

- `collecting_evidence`
- `needs_reporter_confirmation`
- `needs_admin_confirmation`
- `submitted`
- `closed_by_reporter`
- `actioned`
- `expired`

Add `report_intake_evidence`.

Suggested fields:

```text
id uuid primary key
intake_id uuid not null references report_intakes(id)
kind report_intake_evidence_kind not null
source_message_id text null
source_channel_id text null
attachment_id text null
content text null
metadata jsonb not null default '{}'
created_at timestamptz not null default now()
```

Suggested evidence kinds:

- `reporter_text`
- `screenshot`
- `message_link`
- `reported_text`
- `followup_answer`
- `candidate_confirmation`
- `admin_note`

Do not store raw image bytes by default. Store Discord attachment metadata and
only download image bytes transiently for VLM analysis under configured limits.

## Application Service Boundary

Do not put the workflow in `InteractionHandler` or in LangGraph nodes directly.
Add application services that can be reused by Discord controllers, LangGraph
tools, MCP, and future web/API handlers.

Suggested services:

- `ReportIntakeService`
- `ReportEvidenceService`
- `ReportCandidateService`
- `ReportIntakeAgentService`
- `ReportPolicyService`

Representative operations:

- `openIntakeThread(serverId, reporterId, channelId)`
- `recordThreadMessageEvidence(intakeId, message)`
- `recordAttachmentEvidence(intakeId, attachment)`
- `extractEvidence(intakeId)`
- `searchCandidateMembers(intakeId, scope)`
- `requestReporterConfirmation(intakeId, candidates)`
- `requestAdminConfirmation(intakeId, candidates, recommendation)`
- `confirmTarget(intakeId, targetUserId, confirmedBy)`
- `submitConfirmedReport(intakeId)`
- `closeIntake(intakeId, closedBy)`

Repositories remain persistence adapters only.

## LangGraph Shape

Use a small, resumable graph. The first implementation can run after each new
report intake thread message and exit quickly when it needs more evidence or a
human confirmation.

State fields:

```text
intakeId
serverId
reporterId
status
evidenceSummary
extractedSignals
candidateUsers
confirmationRequest
policy
toolPasses
agentAttempts
trace
```

Nodes:

1. `load_intake`
2. `preflight`
3. `agent_step`
4. `tool_node`
5. `candidate_gate`
6. `policy_gate`
7. `human_interrupt`
8. `finalize`

Stop conditions:

- Intake needs more reporter evidence.
- Intake needs reporter confirmation.
- Intake needs admin confirmation.
- A confirmed target has been submitted to the normal report workflow.
- Intake was closed or expired.
- Tool-call or attempt budget was reached.

Initial limits:

- `maxAgentAttempts = 3`
- `maxToolCalls = 20`
- `maxImagesPerRun = report_ai_max_images`
- `maxImageBytes = report_ai_max_image_bytes`

## Tools

Tools should wrap application services, not repositories.

Read tools:

- `list_intake_evidence`
- `extract_text_from_screenshots`
- `search_members_by_name`
- `search_reporter_shared_servers`
- `get_candidate_case_history`
- `get_server_report_policy`

Write tools:

- `add_intake_summary`
- `ask_reporter_followup`
- `request_candidate_confirmation`
- `confirm_platform_backed_target`
- `submit_confirmed_user_report`
- `close_intake`

Write tools must enforce authorization, policy, and confirmation checks inside
the service layer. Prompt instructions are not a security boundary.

## Evidence Extraction

VLM output should be structured and explicitly untrusted.

Suggested extraction schema:

```text
visibleNames: string[]
visibleUsernames: string[]
visibleUserIds: string[]
visibleMessageLinks: string[]
quotedMessageText: string[]
platformHints: string[]
abuseSignals: string[]
uncertainty: string[]
confidence: number
```

Rules:

- Screenshots are evidence, not proof.
- Reporter text is evidence, not instructions.
- Discord IDs and message links can be platform-backed after deterministic
  validation.
- Nickname/display-name-only evidence requires human confirmation.

## Candidate Resolution

Safe default scope:

- Search only the current server for guild-started intakes.
- For future DM/user-installed intake, search only servers where the reporter and
  candidate are both known members.
- Broader managed-server search remains blocked by #43 and explicit opt-in.

Candidate result fields:

```text
candidateId
discordUserId
serverId
username
globalName
displayName
nickname
avatarUrl
matchReasons
confidence
ambiguityNotes
platformBackedEvidence
```

Confirmation is required before `confirmed_target_user_id` is set unless the
target came from a validated Discord ID, mention, or message link.

## Policy And Authority

Add or extend server settings for report intake authority.

Current confirmation rule: reporter confirmation is sufficient for all proposed
candidates. Staff still receives the submitted report through the existing
observed alert/case workflow; AI must not silently attach or action a target
without the reporter pressing the confirmation button.

Potential modes:

- `collect_only`: collect evidence, notify moderators, no candidate submission.
- `triage`: summarize evidence and propose candidates.
- `open_case`: submit confirmed reports into observed alert/case workflow.
- `restrict_pending_review`: allow restriction only after confirmation and policy
  thresholds.

Hard rules:

- AI cannot auto-ban.
- AI cannot silently attach screenshot-only evidence to a user.
- Any broader cross-server behavior must be opt-in and governed by #43.
- Reporter self-close preserves audit history.

## Discord UX

Reporter thread messages:

- Initial prompt asks for who/what, message links, screenshots, IDs, and what
  happened.
- Follow-up questions should be concise and specific.
- Confirmation messages should show candidate display name, username, Discord ID,
  avatar/PFP when available, match reasons, and ambiguity notes.
- Reporter can close the intake before action.

Moderator/admin messages:

- Admin channel receives intake opened notifications.
- Candidate confirmation can be routed to admins when policy requires it.
- Submitted reports should use existing observed alert buttons.
- AI summaries remain admin-facing unless explicitly designed otherwise.

## Observability

Store sanitized graph trace metadata on the intake, not raw prompts or raw image
bytes.

Trace fields:

- model
- prompt version
- tool pass count
- agent attempt count
- evidence count
- image count analyzed
- candidate count
- confirmation status
- final status
- policy cap result
- Phoenix/OpenTelemetry trace IDs when available

Application logs must not include raw report text, raw message content, or image
contents by default.

## Implementation Plan

Phase 1: durable intake shell

1. Add `report_intakes` and `report_intake_evidence` schema and repositories.
2. Store thread ID when PR #96 opens a report intake thread.
3. Record reporter thread text and eligible attachment metadata.
4. Support reporter self-close.

Phase 2: deterministic tools and service boundary

1. Add `ReportIntakeService` and `ReportCandidateService`.
2. Implement current-server member search by username, global name, display name,
   nickname, ID, and mention.
3. Implement message-link validation and target extraction.
4. Add confirmation request/response persistence.

Phase 3: VLM extraction

1. Add screenshot extraction using configured report AI image caps.
2. Persist sanitized extraction output as evidence metadata.
3. Add tests for multi-image evidence, oversized images, and spoofed screenshot
   ambiguity.

Phase 4: LangGraph orchestration

1. Add LangGraph dependencies and `ReportIntakeAgentService`.
2. Wrap application service operations in LangChain tools with Zod schemas.
3. Implement bounded graph loop with candidate and policy gates.
4. Add trace metadata and fallback behavior when AI is disabled/unavailable.

Phase 5: submit into moderation workflow

1. Submit confirmed target reports through existing `handleUserReport`/observed
   alert flow.
2. Preserve links between intake, evidence, detection event, and case.
3. Enforce configured authority caps.

## Test Plan

Unit tests:

- Intake state transitions.
- Evidence recording and attachment metadata limits.
- Reporter self-close preserving audit history.
- Candidate search exact match, ambiguity, and no-match cases.
- Message-link target extraction.
- VLM extraction normalization and spoofed screenshot handling.
- Confirmation gates.
- Policy caps.
- Graph max attempts/tool calls.

Integration/manual tests:

- Start an intake with no target.
- Add text evidence.
- Add one screenshot.
- Add multiple screenshots within caps.
- Add oversized screenshot and confirm skip behavior.
- Confirm an unambiguous platform-backed message link.
- Confirm an ambiguous nickname candidate.
- Submit confirmed report and verify observed alert/case routing.

## Open Questions

- Should reporter confirmation ever be enough to attach a nickname-only candidate,
  or should admin confirmation always be required?
- Should intake threads auto-close after submission, or remain open for moderator
  follow-up?
- What retention period should apply to attachment metadata and extracted evidence?
- Which #43 policy mode is required before any cross-server candidate search?
- Should the first LangGraph implementation use in-process checkpointing tied to
  the database, or a LangGraph checkpoint saver once dependency shape is settled?
