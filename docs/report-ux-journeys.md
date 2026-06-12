# Report UX Journeys

This note evaluates Drasil's report UX after adding server-installed and user-installed reporting. It focuses on what each persona experiences, where the current implementation is intentionally conservative, and what a better long-term UX could look like.

## Product Boundary

Reports are human-submitted signals, not proof. A report can open moderator review, but it should not automatically restrict or ban a user unless a moderator or a separate configured detector takes that action.

External reports from DMs or group DMs are even weaker signals because they cross server trust boundaries. They must remain opt-in per server and review-only.

## Personas

Reporter:
The user who submits `/report`, `Report User`, or `Report Message`. They need fast submission, clear confirmation, and confidence that the report reached the right place.

Reported user:
The user being reported or flagged. They should not be notified for a report-only review. If moderators restrict or ban them through the case flow, they need a visible path to respond when the action is reversible.

Moderator:
The person triaging reports and detections. They need enough context to decide whether to ignore, watch, restrict, verify, or ban. They also need low-noise action controls.

Server admin:
The person configuring Drasil. They need safe defaults, clear opt-in boundaries, and predictable server-specific behavior.

Bot operator:
The maintainer watching deployments, logs, permissions, and Discord API failures. They need failure modes that do not leave users restricted without a visible path.

## Current Journeys

### Guild `/report`

1. Reporter uses `/report` in a server and optionally provides a reason.
2. Drasil creates a `USER_REPORT` detection event for that server.
3. If the reported user already has an active case, Drasil links the report to that case and updates the case notification.
4. Otherwise Drasil posts or updates a moderator-facing observed alert with action buttons.
5. Reported user is not added, mentioned, restricted, or notified.
6. Moderators decide whether to dismiss, mark false positive, open a case, restrict, ban, or inspect history.

Current UX result:
Good for privacy and low clutter. Reports start as triage alerts instead of creating a thread for every report.

### Guild Report Instructions Button

1. Reporter clicks the report instructions button in a configured report channel.
2. Drasil opens a private report intake thread and adds the reporter.
3. Drasil adds configured case responders when responder routing is enabled.
4. Reporter adds freeform context: who or what they are reporting, message links, screenshots, IDs, mentions, and what happened.
5. Drasil records text, links, and eligible screenshot metadata as durable evidence, then uses deterministic candidate resolution plus debounced AI/VLM extraction to propose possible Discord users.
6. The reporter must answer the Yes/No target prompt before Drasil submits a `USER_REPORT` detection event.
7. Moderators get a no-ping intake-start embed immediately, and later get the normal observed alert or case notification only after a target is confirmed and routing policy allows it.

Current UX result:
Avoids Discord's limited recent-user picker while still requiring reporter confirmation before screenshot/name-only evidence attaches to a Discord user. The button is context intake first, not silent target selection.
See `docs/report-intake-agent-design.md` for the deeper VLM/LangGraph follow-up plan.

### Guild `Report User`

1. Reporter right-clicks a user and chooses `Apps` -> `Report User`.
2. If a reason is required, Drasil redirects the reporter to `/report` because user context-menu commands cannot collect options directly.
3. Otherwise the flow matches guild `/report`.

Current UX result:
Fast when reasons are optional. Awkward but honest when reasons are required.

### Server Message Report

1. Reporter right-clicks a message in a server and chooses `Apps` -> `Report Message`.
2. Drasil opens a modal for the reason.
3. Drasil creates a server-local `USER_REPORT` detection event.
4. If there is no active case for the reported user, Drasil posts or updates a moderator-facing observed alert.
5. Reported user is not added, mentioned, restricted, or notified.

Current UX result:
The reporter gets a familiar Discord-native report flow. Moderators get preserved message context without automatic thread creation.

### External DM/GDM Message Report, Server Mode `off`

1. Reporter uses user-installed `Report Message` in a DM or group DM.
2. Drasil stores the global report signal.
3. No managed server receives a visible notification or case.

Current UX result:
Safest default. Reporter may not understand that no server acted on the report unless the confirmation copy is explicit.

### External DM/GDM Message Report, Server Mode `notify_only`

1. Reporter submits a DM/GDM report.
2. Drasil identifies managed servers where the reported user is known.
3. Opted-in servers receive a moderator-facing observed alert with the existing action buttons.
4. No case thread is created by default, and no moderation action is applied automatically.

Current UX result:
Good low-commitment signal for moderators. It avoids case clutter but may be easy to miss if notifications are noisy.

### External DM/GDM Message Report, Server Mode `open_case`

1. Reporter submits a DM/GDM report.
2. Drasil identifies opted-in servers where the reported user is known.
3. Each opted-in server gets the same moderator-facing observed alert as `notify_only`.
4. No case thread is created by default.
5. No automatic restriction is applied.

Current UX result:
Currently equivalent to `notify_only`; retained as a separate mode for compatibility and future UX polish. External `open_case` does not create a case thread yet.

### Moderator Escalates A Report Case

1. Moderator reviews the report alert or existing case.
2. Moderator opens a case, restricts, lifts restriction, or bans the reported user.
3. If the moderator opens a case without restriction, Drasil creates a normal user-visible case thread and leaves the user unrestricted.
4. If the moderator restricts, Drasil creates or reuses the normal user-visible case thread before applying the restriction.
5. If the moderator bans directly from an alert, Drasil bans and logs the action without creating a user-visible verification thread.

Current UX result:
This is the critical safety invariant. Report-only stays quiet until a moderator opens a case or restricts; opening a case creates the same visible case surface whether or not the user is restricted.

## Previous Implementation Tradeoff

The previous implementation created a moderator-only private thread for report-only cases. This was a low-risk implementation because it reused the existing `verification_events` case model and `thread_id` lifecycle.

Benefits:

- Preserves rich report context in a durable workspace.
- Keeps report-only discussion away from the reported user.
- Reuses existing moderator case patterns and action controls.
- Avoids a larger refactor of notifications, buttons, and case state.

Costs:

- Creates a thread even when moderators only need a compact alert.
- Makes `thread_id` ambiguous unless thread type is tracked.
- Increases channel/thread clutter for low-quality reports.
- Can make report-only cases feel heavier than observe-only suspicious activity.

The `metadata.thread_type` distinction still exists as a safety fallback for cases that already have report review threads.

## Embed-First, Lazy Thread

Report-only intake starts as an observed alert instead of immediately opening a case thread. This matches the action model Drasil already has for observed detections.

1. Report creates a `USER_REPORT` detection event.
2. Drasil posts or updates a moderator-facing observed alert embed with report context and action buttons.
3. No verification event or thread is created yet.
4. Moderator can use the existing observed alert actions: `Open Case`, `Restrict`, `Ban`, `Dismiss...`, and `History`.
5. `Dismiss...` keeps the existing flow: `Dismiss Alert`, `False Positive`, and undo.
6. `Restrict` creates or reuses a case, restricts the user, and creates a user-visible verification thread.
7. `Ban` bans and logs the action without creating a user-visible thread.
8. `Open Case` is the deliberate path for moderators who want a normal case without immediately restricting the user.

Benefits:

- Lower clutter for report-only review.
- Aligns reports with observe-only suspicious activity UX.
- Keeps thread creation tied to cases instead of report alerts.
- Reuses existing observed alert dismissal, false-positive, undo, and history actions.

Costs:

- Report submissions would no longer immediately create a pending case, so any code or docs that assume user reports always create cases must be updated.
- `Open Case` needs a clear product meaning for reports: it creates a normal case and user-visible thread without applying restriction.
- Legacy report review threads remain as a safety fallback for existing cases, not the default workspace for new cases.

## Recommendation

Keep report-only intake on the existing observed alert UX. Do not introduce a new case model just for reports.

Target behavior:

- Report submission: moderator-facing observed alert embed with action buttons, no case/thread by default.
- Moderator opens case: create a normal user-visible case thread without restricting the user.
- Moderator restricts: create or reuse the normal case thread and apply the restricted role.
- Moderator lifts restriction: keep the case open and remove the restricted role.
- Moderator bans: ban and log the action, with no user-visible verification thread.
- External `notify_only`: observed alert with action buttons, no case thread.
- External `open_case`: currently the same observed-alert behavior as `notify_only`, retained for compatibility and future UX polish.

The key product rule should be: report triage needs context and buttons; a case means a user-visible case surface; restriction is a reversible state on an open case, not a separate hidden case type.

## Open Questions

- Should external reports show which server(s) received the report in the reporter confirmation, or keep that intentionally opaque?
- If the reporter is an admin in one or more servers that receive an external report, should the confirmation name those servers?
- Should repeated reports update one embed, append a summary, or create separate case entries?
- Should legacy moderator-only review threads be migrated or removed once no active cases use them?
- Should `Open Case` be relabeled for report alerts, or is the existing label clear enough?

## Follow-Up Work

1. Consider whether `Open Case` should be relabeled for report alerts.
2. Decide whether admin reporters should see which servers received an external report.
3. Preserve the current thread-type upgrade behavior as a safety fallback for existing cases.
4. Decide the parent-channel permission strategy for unrestricted user-visible case threads.
5. Update manual QA to cover reporter confirmation, moderator alert actions, dismissal/false-positive undo, open case, restrict, lift restriction, and ban.
