# CAPTCHA methods rollout

This runbook covers the methods extension tracked in [#261](https://github.com/BASIC-BIT/drasil/issues/261).
It does not authorize production setup or live member actions. No owned disposable
application, server, member or case has been approved for a live run. Live Discord,
OAuth and provider observations remain unverified. Broader issuance, resolution
rules, defaults and deployment-origin reconciliation remain separate work.

## Release and settings

Deploy the additive `20261023090000_captcha_image_method` migration and compatible
bot/web readers before enabling image issuance. Existing challenges remain
Turnstile. Absent saved methods retain the legacy Off-to-None and active-to-Turnstile
mapping. None remains the effective new-server default. No deployment enables
CAPTCHA across servers.

Administrators choose exactly one method. Issuance and pass action remain separate.
Defaults stay 24 hours, five invalid submissions and evidence only. Retain the
configured bounds. Selecting an active method while issuance is Off defaults to
manual on activation; a same-method Off resave retains Off. Members cannot choose
the method, refresh without bounds or receive a fallback during outages.

Changing methods increments the method revision and cancels pending generations
under the settings transaction. Old controls become stale, and stored PNGs/digests
are removed. A moderator must issue a replacement; method changes do not backfill
cases. Choosing None is rollback. It cancels checks without resolving cases or
removing containment. Keep the additive schema and compatible readers deployed.

## Image key and readiness

Create an independent cryptographic image-answer key of at least 32 random bytes,
encoded as canonical standard base64. The decoder rejects whitespace, URL-safe
encoding, malformed padding and short keys. A protected-file example is:

```sh
(umask 077; openssl rand 32 | openssl base64 -A > /secure/path/captcha-image-key)
```

Use an operator-owned secure path. Deliver that file through the environment's
secret-manager upload mechanism without printing its value or putting it in shell
arguments, chat, source, issues or artifacts. Remove the protected transfer file
according to the operator's secret-handling procedure after upload. Never reuse a
Turnstile, session or binding key.

Inject `DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET` into both bot and web server runtimes,
then restart/redeploy them through the approved configuration process. Do not
prefix it with `NEXT_PUBLIC_`. The current Terraform secret metadata list does not
create this key or wire it automatically. Review secret references, access policy
and environment identity as concrete configuration before an operational apply.
This branch does not provision secrets or change production task definitions.

Bot setup readiness requires a valid key, loadable `captcha-canvas`/`skia-canvas`
and Liberation Sans. Web setup readiness validates the key without loading native
rendering. Verify both actual runtimes; a successful web settings save does not
prove bot rendering works. Run `scripts/probe-captcha-image.mjs` inside the built,
production-pruned bot image. Image checks need no Turnstile configuration or public
web origin. Runtime renderer/storage/delivery failures hold the case for retry or
moderator help without charging an answer attempt.

Answers use six crypto-random uppercase characters from
`23456789ABCDEFGHJKMNPQRSTUVWXYZ`. Only surrounding whitespace and ASCII case are
normalized. The persisted keyed digest binds server, member, case, challenge,
generation and answer. Reopens reuse the stored PNG and digest; they never reset
attempts. Answers must never enter filenames, attachment descriptions, alt text,
component IDs, URLs, logs, audit records or analytics. Attachment visibility does
not authorize an interaction.

There is no previous-key registry. Coordinate rotation across bot and web. Access
to material whose key fingerprint differs atomically deletes it and marks that
pending generation `image_key_rotated`; it cannot regenerate in place. A moderator
retry advances the generation and issues fresh material with the new key. Missing
or malformed keys return unavailable without charging attempts. Plan the target
pending-check invalidation and reissue scope before rotation. Do not promise old
answers survive it. Terminal state or generation replacement deletes private
material transactionally; the bounded minute sweep also removes expired material
and handles disabled/terminal-case pending checks. Cached Discord attachments may
remain visible, but old generations cannot complete.

## Turnstile configuration and origins

| Variable                                            | Role                                                     |
| --------------------------------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                    | Public widget key, supplied to the browser build         |
| `TURNSTILE_SECRET_KEY`                              | Private provider Siteverify credential                   |
| `TURNSTILE_EXPECTED_HOSTNAME`                       | Exact expected hostname, without scheme or path          |
| `DRASIL_CAPTCHA_BINDING_SECRET`                     | Separate application-owned private challenge-binding key |
| `NEXT_PUBLIC_APP_URL` / bot `DRASIL_WEB_PUBLIC_URL` | Canonical public origin for browser links and OAuth      |

Confirm the provider widget permits the intended hostname. Validate server-side
hostname, action `drasil_case_access` and challenge binding; a rendered widget or
dummy token is not evidence of real validation. Keep site key/provider secret
pairs and Discord application identities separate for development and production.
Use each environment's actual origin and register its own redirects:

- Dashboard: `https://<environment-host>/api/auth/discord/callback`
- CAPTCHA identity confirmation: `https://<environment-host>/api/captcha/auth/callback`
- MCP, only if separately enabled: `https://<environment-host>/api/mcp-auth/callback/discord`

Development loopback HTTP is supported; production requires HTTPS. Inspect the
running bot origin rather than inferring it from Terraform declarations. The image
deploy edits an existing task definition's image and release marker, so it does
not repair a missing origin. Operational reconciliation needs its own reviewed
configuration change. None requires no provider. Selecting Turnstile requires all
four provider variables plus the public origin, and runtime errors never switch
members to image checks.

## Evidence and remaining gates

Package and owned-database tests exercise actor mismatch, attempts, expiry,
restarts, old generations, settings/revision races, duplicate submissions,
assistance idempotency, queue holds and eligible join-only resolution. These are
synthetic tests, not observed Discord or provider behavior. See
[renderer evaluation](captcha-image-evaluation.md) for container measurements and
[approved design](superpowers/specs/2026-10-22-captcha-methods-design.md) for the
security contract. Final branch validation and any remaining failures must be
recorded with the release review before rollout.

Task 7's two new CAPTCHA Storybook stories passed and four existing case visual
tests failed. At that stage exact byte-identical BASE comparison established
drift for stale-light only. The remaining old cases and dark schemes were not
individually proven identical by Task 7. The later controlled Task 8 investigation
below extends evidence only to its explicitly compared images.

The user-supplied desktop Activity probe reached SDK readiness, then Cloudflare's
script failed at the Activity CSP. No widget or dummy token followed. Discord web
was blank for an unresolved reason. Mobile, real Siteverify, OAuth, challenge
binding and moderation effects remain unverified. This is supplied evidence, not
an observation made by this cloud agent. The temporary development Activity
mapping and deployment remain in place; coordinate cleanup separately with the
owner. Image rollout must not toggle the mapping or delete that deployment.

Human image readability has zero evaluated samples, including desktop, mobile and
accessibility. This visual method offers moderator assistance and makes no claim
of independent accessibility for blind members. The small OCR evaluation does
not establish bot resistance.

## Initial validation record, 2026-10-23

The initial `npm run check:ci` invocation exited 1 at the full web visual
gate. This section preserves that red result and its then-unresolved attribution.
The later font isolation, scoped controls and corrected validation are recorded
below. Neither run is a live rollout-readiness claim. Package,
owned-database, container and fixture-browser evidence does not verify live
Discord delivery, OAuth or provider operation.

| Gate                                            | Result                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Application coverage                            | 540 passed                                                              |
| Native unit suite                               | 1,886 passed, 96 snapshots                                              |
| Contracts coverage                              | 42 passed                                                               |
| Web coverage                                    | 666 passed                                                              |
| Web production build and MCP packaging          | Passed                                                                  |
| Native renderer exclusion                       | 34 production traces and 26 browser chunks, zero matches                |
| Storybook build                                 | Passed                                                                  |
| Functional browser suite                        | 44 passed, 12 dedicated MCP cases skipped here                          |
| Full web visual suite                           | 15 failed, 1 passed, guild setup                                        |
| Full Storybook visual suite                     | 15 failed, 3 passed; two new CAPTCHA stories and functional shim passed |
| Native integration                              | 27 suites, 752 passed                                                   |
| Web integration                                 | 3 files, 51 passed                                                      |
| Dedicated MCP browser suite                     | 12 passed; local mock harness and owned database                        |
| Public RLS check                                | Passed for 44 owned-fixture tables                                      |
| Full bot runtime build and final renderer probe | Passed, 52 renders; see image evaluation                                |

The initial web visual failures below were screenshot assertions. Their BASE
identity and cause had not yet been established. Twelve full-page tests failed both light and dark. The
three element tests failed the first hard light assertion, so their dark schemes
were not exercised. No snapshots were updated or skipped in that initial run; later exact authorized
repairs are recorded below.

| Failed web screenshot stem      | Failed schemes            |
| ------------------------------- | ------------------------- |
| `report-entry-admin-server-row` | light; dark not exercised |
| `admin-guild-list`              | light and dark            |
| `report-entry-case-detail-nav`  | light; dark not exercised |
| `case-detail`                   | light and dark            |
| `case-history`                  | light and dark            |
| `report-entry-case-queue-nav`   | light; dark not exercised |
| `case-queue`                    | light and dark            |
| `landing-page`                  | light and dark            |
| `member-profile`                | light and dark            |
| `moderation-inbox-mobile`       | light and dark            |
| `moderation-inbox`              | light and dark            |
| `operations`                    | light and dark            |
| `report-detail`                 | light and dark            |
| `report-portal`                 | light and dark            |
| `report-queue`                  | light and dark            |

Local review evidence is retained in `/tmp/task8-check-ci.log`,
`/tmp/task8-web-visual-failures.json` and
`/tmp/task8-web-visual-evidence/`, including expected/actual/diff screenshots and
the HTML report. These paths refer to the validation workspace, not a deployed
service. The prior Task 7 stale-light-only BASE proof above does not establish
identity for these broader failures. The remaining gates run individually in
the original order after CI stopped; their results are recorded separately.

The resumed full Storybook gate also exited 1. Fifteen visual tests failed both
light and dark, 30 screenshots. The two new CAPTCHA stories and existing
functional navigation test passed. Exact failing stems:

| Failed Storybook screenshot stem        | Failed schemes |
| --------------------------------------- | -------------- |
| `storybook-case-detail-banned`          | light and dark |
| `storybook-case-detail-left`            | light and dark |
| `storybook-case-detail-resolved-reopen` | light and dark |
| `storybook-case-detail-stale`           | light and dark |
| `storybook-case-history-empty`          | light and dark |
| `storybook-case-history-mixed`          | light and dark |
| `storybook-case-queue-empty`            | light and dark |
| `storybook-case-queue-mixed`            | light and dark |
| `storybook-member-profile-banned`       | light and dark |
| `storybook-moderation-inbox-empty`      | light and dark |
| `storybook-moderation-inbox-mixed`      | light and dark |
| `storybook-report-detail-linked`        | light and dark |
| `storybook-report-detail-submitted`     | light and dark |
| `storybook-report-queue-empty`          | light and dark |
| `storybook-report-queue-mixed`          | light and dark |

Evidence paths are `/tmp/task8-storybook-visual.log`,
`/tmp/task8-storybook-visual-failures.json` and
`/tmp/task8-storybook-visual-evidence/`. Final stale-light was rehashed against the
recorded BASE artifact and remains byte-identical at SHA-256
`6b3baa783ceab5c4a817ae6b158d2e568fc3bafe2d223089ac38a391d174a489`.
`/tmp/task8-stale-light-proof.json` records that comparison. At that point every other old Storybook case/scheme and the broader web visual
failures remained unattributed. The new controls below establish additional
image-specific evidence rather than extending the old proof by assumption.

Resumed gate logs are `/tmp/task8-native-integration.log`,
`/tmp/task8-web-integration.log`, `/tmp/task8-mcp-e2e.log` and
`/tmp/task8-rls.log`. Every resumed database consumer ran serially with the same
three guarded URLs for the owned loopback fixture. No production database or
member/case action was used. Runtime and bundle evidence is retained in
`/tmp/task8-runtime-final-build.log`, `/tmp/task8-runtime-probe.json`,
`/tmp/task8-runtime-metadata.json`, `/tmp/task8-runtime-imports.log`,
`/tmp/task8-runtime-source-hashes.txt` and `/tmp/task8-renderer-packaging.json`.
The completed resumed gates did not change that initial failed CI result. The
later full rerun is recorded independently below. Live rollout remains
unverified and requires the owner-designated target below.

## Controlled font and baseline correction

The managed host's strong OpenAI Sans alias explained the broad generic-font
differences. The unchanged landing light and dark baselines passed with the
process-local DejaVu Sans configuration below. Under that same immutable config,
the full web suite improved to 12 passes and four failures; Storybook improved
to 11 passes and seven failures. No expected images changed during that isolation.

Remaining old images were compared against original product BASE
`599ef8622efd602b0c564d683e4dd227c4c86d85`. The control temporarily restored exactly
`CaseDetailView.tsx`, `CaseActionControls.tsx`, `ModerationInboxView.tsx` and
`casePresentation.ts`, leaving the same HEAD fixtures, stories and styles. This
was a scoped renderer control, not a complete old-tree checkout. All four
remaining old web PNGs and all seven remaining old Storybook PNGs were
byte-identical to HEAD under the same font and browser environment.

CDP samples of actual visible paragraphs, buttons, action pills, code and other
rendered text recorded platform fonts and computed family, weight and size.
Body/action text uses DejaVu Sans or DejaVuSans-Bold; rendered code uses
Liberation Mono. The closed export textarea's ui-monospace stack did not render
and was not changed speculatively. Named Liberation Sans selection is preserved
for native rendering. No host font files, product CSS or moderation behavior
changed.

The controller approved only 11 exact BASE-equal images as pre-existing snapshot
debt, plus the six intended Task 7 setup/new CAPTCHA images originally captured
under the host alias. The operations snapshot predates a canonical fixture
change from queued at 01:10 to completed at 01:11; the actual completed row was
visually checked against that unchanged fixture. Setup and both new CAPTCHA
stories were reviewed in light and dark with the corrected font. These expected
images were replaced from the reviewed HEAD captures, without a broad snapshot
update command:

| Expected PNG                                                | Reason                                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| `case-detail-linux-light.png`                               | Exact BASE-equal pre-existing test debt  |
| `moderation-inbox-mobile-linux-light.png`                   | Exact BASE-equal pre-existing test debt  |
| `operations-linux-dark.png`                                 | Exact BASE-equal pre-existing test debt  |
| `operations-linux-light.png`                                | Exact BASE-equal pre-existing test debt  |
| `storybook-case-detail-stale-linux-dark.png`                | Exact BASE-equal pre-existing test debt  |
| `storybook-case-detail-stale-linux-light.png`               | Exact BASE-equal pre-existing test debt  |
| `storybook-case-queue-mixed-linux-dark.png`                 | Exact BASE-equal pre-existing test debt  |
| `storybook-case-queue-mixed-linux-light.png`                | Exact BASE-equal pre-existing test debt  |
| `storybook-moderation-inbox-mixed-linux-light.png`          | Exact BASE-equal pre-existing test debt  |
| `storybook-report-detail-submitted-linux-light.png`         | Exact BASE-equal pre-existing test debt  |
| `storybook-report-queue-mixed-linux-light.png`              | Exact BASE-equal pre-existing test debt  |
| `guild-setup-linux-light.png`                               | Intentional Task 7 image, corrected font |
| `guild-setup-linux-dark.png`                                | Intentional Task 7 image, corrected font |
| `storybook-turnstile-script-failure-linux-light.png`        | Intentional Task 7 image, corrected font |
| `storybook-turnstile-script-failure-linux-dark.png`         | Intentional Task 7 image, corrected font |
| `storybook-case-detail-image-check-history-linux-light.png` | Intentional Task 7 image, corrected font |
| `storybook-case-detail-image-check-history-linux-dark.png`  | Intentional Task 7 image, corrected font |

Web images live in `apps/web/e2e/visual.spec.ts-snapshots`; Storybook images live
in `apps/web/storybook-e2e/visual.spec.ts-snapshots`. Only these 17 of 128 tracked
expected PNGs changed. All 111 other expected images retain their original
bytes. This is an explicit baseline-debt repair and font correction, not a claim
that product moderation behavior changed.

Evidence includes `/tmp/task8-font-landing-proof.log`,
`/tmp/task8-font-base-web-comparison.json`,
`/tmp/task8-font-base-storybook-comparison.json`,
`/tmp/task8-font-base-web-control.log`,
`/tmp/task8-font-base-storybook-control.log`,
`/tmp/task8-font-snapshot-updates.json` and
`/tmp/task8-font-snapshot-preservation.json`. The renderer control and temporary
CDP instrumentation were fully restored, with byte checks recorded in
`/tmp/task8-font-control-restoration.json`. The first EXIT restoration used a
relative destination after changing directories and failed; absolute-path
restoration immediately recovered all six backed-up files before further tests.
No temporary production/test instrumentation remains.

| Corrected validation                                   | Result         |
| ------------------------------------------------------ | -------------- |
| Full web visual gate after exact repair                | 16 passed      |
| Full Storybook visual gate after exact repair          | 18 passed      |
| New complete `npm run check:ci`, same font environment | Passed, exit 0 |

The complete rerun used immutable font config SHA-256
`e741d2a0446e349fcc9f3da7bc49aacedafe9c820bce32a6b5484d3c8fac41e5`,
the same installed browser and three identical owned-fixture URLs. The full
required chain completed in `/tmp/task8-fix1-check-ci.log`: application 540,
native 1,886 plus 96 snapshots, contracts 42 and web 666 tests; production web
and Storybook builds and packaging; functional browser 44; web visual 16;
Storybook visual 18; native integration 752 across 27 suites; web integration
51 across three files; dedicated MCP browser 12; and public RLS across 44 tables.
The 12 MCP cases omitted from the ordinary functional browser gate passed in
the dedicated gate. Existing native lint warnings remain. A fresh production
web scan again found zero native renderer references in 34 dependency traces
and 26 browser chunks: `/tmp/task8-fix1-renderer-packaging.json`.

This passing full rerun supersedes the initial red validation outcome without
removing its history. All 111 unrelated expected PNGs remain byte-identical;
`/tmp/task8-font-snapshot-preservation-final.json` also verifies every approved
replacement matches its reviewed capture. Live Discord/provider operation and
human image readability remain unverified.

The previous bot runtime build and renderer probe remain valid. This correction
changes only operator documentation, process-local test environment and expected
screenshots. The retained runtime image predates those validation-only files;
its production source, Dockerfile and dependencies are unchanged.

## Process-local Linux browser fonts

This managed host adds a strong `sans-serif` alias to OpenAI Sans in
`/etc/fonts/conf.d/52-orbit-os.conf`. The unchanged landing Linux baseline matches DejaVu Sans metrics. A controlled unchanged landing-page test passes in light
and dark when the browser process resolves the generic families to the already
installed DejaVu Sans. Product CSS and host font configuration stay unchanged.

Use a process-local Fontconfig file with a private temporary cache. Match generic
families before including the system rules, which otherwise expand `system-ui`
before a later override can match it. Named fonts such as the image renderer's
Liberation Sans retain their normal selection. Do not refresh unrelated expected
screenshots to accommodate a host's generic-font alias.

From the repository root, after setting the three identical owned disposable DB
URLs from `AGENTS.md` and the installed `PLAYWRIGHT_BROWSERS_PATH` if needed:

```bash
(
  set -eu
  drasil_visual_font_dir="$(mktemp -d /tmp/drasil-visual-fonts.XXXXXX)"
  trap 'rm -rf "$drasil_visual_font_dir"' EXIT
  mkdir "$drasil_visual_font_dir/cache"
  cat > "$drasil_visual_font_dir/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <match target="pattern">
    <test name="family" qual="first"><string>ui-sans-serif</string></test>
    <edit name="family" mode="assign_replace" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
  <match target="pattern">
    <test name="family" qual="first"><string>system-ui</string></test>
    <edit name="family" mode="assign_replace" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
  <match target="pattern">
    <test name="family" qual="first"><string>sans-serif</string></test>
    <edit name="family" mode="assign_replace" binding="strong"><string>DejaVu Sans</string></edit>
  </match>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <cachedir>$drasil_visual_font_dir/cache</cachedir>
</fontconfig>
EOF
  chmod 0444 "$drasil_visual_font_dir/fonts.conf"
  FONTCONFIG_FILE="$drasil_visual_font_dir/fonts.conf" fc-match ':family=system-ui'
  FONTCONFIG_FILE="$drasil_visual_font_dir/fonts.conf" npm run check:ci
)
```

The subshell exports the override only to the check and its children, then removes
its own config/cache. It does not change global Fontconfig, product styles, TLS
trust or browser settings. This recipe requires installed DejaVu Sans; verify
selection with `fc-match ':family=system-ui'` under the same `FONTCONFIG_FILE`.

## Owned disposable live checklist

Do not run until the owner identifies and approves every target and setting
change below. Fill in identifiers privately in the operator record, never answer
values or secret values. This ready checklist does not require production access.

- [ ] Record environment, application identity, bot/web release, server, challenged
      disposable member, separate mismatch actor, standard case and current revision.
- [ ] Record current method, issuance mode, pass action, lifetime and attempt limit;
      approve exact temporary settings, restart scope and restoration values.
- [ ] Verify additive migration, both runtime readiness checks, intended private
      delivery channel, bot permissions and queue health. Confirm target is disposable.
- [ ] Select image explicitly. Request a moderator-issued evidence-only check.
      Confirm the case thread contains a neutral entry control and only the bound
      member receives the private PNG with Enter answer and Ask for help.
- [ ] On desktop, enter the answer while viewing the private image. Repeat on a
      named mobile client/version with the answer modal above the image. Record
      whether the image remains usable, closing/reopening behavior and assistance.
- [ ] Use the mismatch actor to open/submit/help. Expect denial, no private image,
      no consumed attempt and no accepted evidence. Inspect no sensitive output.
- [ ] Submit wrong answers through exhaustion. Record remaining attempts, expected
      final hold, no kick/ban, and no attempt charge for an injected renderer/delivery
      failure if that fault injection was explicitly approved.
- [ ] Reopen before completion and restart the approved disposable bot process.
      Confirm the same image/generation and attempt budget survive; do not record the
      answer. Submit concurrently/duplicate and confirm one durable acceptance and
      one queue effect.
- [ ] Ask for help repeatedly, including after restart. Confirm one durable
      generation-bound moderator notification and no case resolution.
- [ ] Retry as moderator and exercise an old control. Change method and choose
      None using the approved settings scope. Confirm stale generations fail, pending
      material is removed, no replacement is automatic and the case stays pending.
- [ ] Hold queue processing on the disposable target as approved. Complete a check
      and observe evidence before release. Change the case revision or method, resume
      and confirm the final queue operation holds resolution and preserves containment.
- [ ] Separately approve `suspicious_join` plus `verify_join_only` for an eligible
      disposable join case. Confirm exclusively eligible join detections, no other
      pending case, unchanged revision/method and successful queue-owned release.
      Moderator-requested or mixed-evidence cases must remain evidence only.
- [ ] If Turnstile is separately authorized, verify its real browser/OAuth/provider
      flow on its canonical origin with the bound actor; record server validation and
      queue results separately from image results and Activity probe evidence.
- [ ] Restore approved target settings, cancel remaining disposable checks through
      the lifecycle, verify private material cleanup and record unresolved observations.
      Coordinate Activity cleanup as a separate owner-approved action.
