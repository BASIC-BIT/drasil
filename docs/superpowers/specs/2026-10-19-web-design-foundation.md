# Drasil visual foundation and Storybook reference inbox

Date: 2026-10-19

Status: exploratory design notes. On 2026-10-20, the user approved an isolated Storybook slice starting with the everyday report-review flow. See [the working slice](../../design/storybook-report-inbox.md). Broader component scope, dense-data design and production route adoption remain provisional.

## Intent and agreed direction

Build a beautiful, readable Drasil website through deliberate component development in Storybook. The first milestone establishes a reusable visual foundation and proves it on a representative moderation inbox before changing production routes.

The user selected the layout and restrained hierarchy of concept 1, Quiet precision, with the dark appearance of concept 3, Night watch. The user explicitly requires keeping the existing commissioned logo. This supersedes the generated concept board's invented tree marks and the earlier suggestion to develop a new mark.

Later design feedback retains the inbox composition, requires neutral charcoal greys instead of green-tinted backgrounds, and requires the transparent commissioned logo without a background tile. Positioning should emphasize shared protection, smart insights, an opinionated workflow and customizability. "A calmer way to moderate" was rejected. Current headline candidates are "Shared protection. Your rules.", "Shared insight. Stronger protection." and "Protection with a point of view." None is final copy.

Editable exploration: [Drasil Figma file](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I). Desktop inbox: node `3:83`; homepage: `3:16`; mobile list/detail: `3:153` and `3:181`. The browser playground is `/workspace/artifacts/drasil-foundation/drasil-design-playground.html`, a self-contained file with screen, message, viewport, theme, accent and spacing controls. These remain design studies, not production implementation.

Exploration 04 retains the flat inbox, adds continuous pane separation and tests a dense case with Review, Evidence and Activity views. See [the data-presentation study](../../design/data-presentation-exploration.md) for field mapping, source distinctions and the next stress tests. The dense frames are nodes `9:60` and `9:172`. This is an alternative to evaluate alongside the original inbox, not a decision to add tabs everywhere.

The [complete review journey](../../design/review-journey-exploration.md) extends the exploration through dense evidence, a known failure before execution, explicit retry, confirmed completion and a filter-aware next-item handoff. These remain design studies; unknown and partial outcomes still need separate treatment.

The codebase establishes three audiences: administrators configuring protection, authorized staff reviewing moderation work, and members submitting reports. The initial reference inbox serves the staff workflow. Its structure must also support later case/report/history pages, with a related public-page design.

Success means the reviewer can recognize the real Drasil brand, scan a queue, read selected evidence without cramped columns, and understand action status on desktop and mobile. This milestone produces working Storybook components and interactions, not a new moderation backend.

## Scope

Included:

- An inventory and usable web presentation of the commissioned logo.
- Semantic light/dark tokens, typography, spacing, borders, focus and restrained motion.
- Shared controls and navigation components needed by the reference inbox.
- A responsive Storybook inbox composed from these components and existing moderation fixtures.
- Selection, filters, contextual selection actions and mobile list/detail navigation.
- Accessible pending, completed, failed, unavailable and empty presentation states.
- Interaction, accessibility and visual verification of the reference composition.

Follow-on milestones use this reviewed foundation to adopt the real inbox route, build the public homepage and migrate other routes incrementally. The first milestone does not rewrite those routes, change authorization, alter moderation policy or change bot execution. This keeps the first component review independently useful and reversible.

## Existing brand assets

The source artwork lives under `docs/icons/`. Preserve every original file.

- `JPG-2.jpg` is a 6985 by 6985 full-color tree on a dark background. It was usable for the initial study; subsequent mockups use the recovered transparent `PNG-1.png` artwork.
- The tree has green leaves, a warm trunk and visible roots. Preserve its proportions, colors and details. Do not regenerate, trace, simplify, recolor or replace it.
- `JPG-1.jpg`, `JPG-3.jpg`, `JPG-4.jpg` and `JPG-5.jpg` decode but show visible line artifacts in the inspected rendering. Do not select them simply because they decode.
- All six committed PNG files suffered CRLF-to-LF binary corruption. Their original bytes were recovered by restoring the stripped CR bytes, requiring a unique checksum-valid reconstruction for every damaged chunk. All PNG chunk checksums and full image decoding pass. Reapplying the line-ending corruption reproduces each committed file byte for byte. Original files remain untouched. Recovered assets and a receipt are in `/workspace/artifacts/drasil-foundation/recovered-logos/`.

Use the recovered transparent full-color `PNG-1.png`. Create web-sized derivatives by deterministic resizing/encoding while retaining the complete artwork and alpha channel. Do not add a background tile, tint or blend mode. Do not regenerate the logo.

The transparent full-color artwork serves both themes. Review the mark at actual display size and preserve the canopy and roots in full.

The shared brand component renders the original mark with a separate Drasil text label. Avoid duplicate accessible names when the image and text form one home link. Use an empty image alt when adjacent visible text names that same link; a standalone meaningful mark gets appropriate alt text. No generated marks enter product assets.

## Visual system

Dark is the primary design-review theme. Use neutral charcoal-grey surfaces, near-white text, fine grey dividers and a restrained mint action accent. Backgrounds and selected surfaces must not have a green cast. Let the logo provide its own brighter leaf colors and warm trunk color.

Initial dark candidates, subject to measured contrast and visual review:

| Semantic role           | Candidate |
| ----------------------- | --------- |
| Canvas                  | `#141416` |
| Surface                 | `#1A1A1D` |
| Raised/selected surface | `#2B2B2F` |
| Primary text            | `#F1F1F3` |
| Secondary text          | `#B2B2BC` |
| Decorative divider      | `#3C3C43` |
| Strong control boundary | `#75867A` |
| Accent                  | `#9BCBB2` |
| On-accent text          | `#101514` |

The divider is decorative, not the only boundary cue for an interactive control. Focus, field boundaries, selected states and status combinations need their own verified tokens.

Maintain a complete light theme with the same hierarchy: neutral light-grey canvas, white surfaces, charcoal text and restrained green actions. Keep the existing stored theme preference and system-preference fallback. Choosing a dark design reference does not authorize overriding a user's saved light theme.

Use a readable humanist/system sans-serif for UI. UI body text starts at 16px, secondary metadata at 14px and page headings at approximately 26px. Marketing typography can later use a larger scale, but operational headings remain compact. Use tabular numerals where counts/times need alignment. Confirm actual font rendering in both themes before introducing a font dependency.

The current editable design and browser playground explore Manrope, with working editable component text. Typography remains open for comparison; this does not select a production font dependency.

Use a small consistent spacing scale based on 4px, moderate 6–8px control corners, and rules/spacing to separate content. Avoid decorative gradients, large shadows, nested cards and background artwork in the operational interface. Animation should communicate an interaction, respect reduced motion and never delay review.

## Component ownership

Use focused files and locally owned styles for new components. Keep global CSS responsible for tokens, base typography and shared resets rather than adding another page's rules to the existing large stylesheet. Scope the experimental foundation tokens and base styling under a foundation wrapper, with theme selection inherited from the existing theme mechanism. Do not overwrite the current routes' global variables or element styles in this first milestone. Existing routes retain their current appearance until adoption.

| Unit                      | Responsibility                                                           | Dependencies                                                       |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Brand                     | Commissioned image and Drasil label                                      | Vetted asset derivative; no application data                       |
| Control styles            | Buttons, links, icon buttons and search/filter fields                    | Semantic tokens and native HTML semantics                          |
| Status label and feedback | Text/icon treatment for known states                                     | Existing status vocabulary; no business decisions                  |
| Application shell         | Server context, navigation, account/theme placement and responsive frame | Typed navigation data; current theme control                       |
| Queue toolbar             | Search, current filters, count and contextual selection actions          | Existing view-model control definitions                            |
| Queue list/row            | Item identity, type, brief summary, time, selection and checkbox         | Existing inbox item contracts and selected/checked state           |
| Evidence workspace        | Selected item's readable summary, sources, metadata and evidence         | Existing typed item data; source links only where available        |
| Action feedback           | Request lifecycle presentation                                           | Existing request/status data; no mutation implementation           |
| Reference composition     | Compose the above and own local interaction state                        | Existing fixtures/view-model helpers and inert Storybook callbacks |

This is not an instruction to build a generic page schema or wrap every HTML element. Derive types from existing contracts where possible. Presentation must not import database adapters, credentials or live Discord clients. Fixture callbacks simulate interaction outcomes and must not perform real moderation actions.

## Inbox layout and interaction

Desktop at 1440px uses approximately 216px for navigation, 340–380px for the queue and the remaining width for evidence. The evidence workspace should have at least 560px of practical reading width at this reference viewport. Reduce secondary chrome before reducing evidence to a narrow property column.

Navigation contains server context, Inbox, Cases, Reports and History, with Setup and Operations in a quieter section. These reflect existing route destinations. Navigation stories demonstrate active and long-label states; they do not imply broader permission access than the application currently allows.

The page heading is simply Inbox. A small count describes the current queue. Search and common filters sit on one compact toolbar. Advanced filter controls open on demand with an explicit active-filter indicator and reset path. Reuse existing count/filter semantics; do not invent a metric called needs review with different inclusion rules.

Each queue row shows the member, item type, one readable summary and a relevant timestamp/attention label. A selected row has a clear indicator in addition to color. Row selection and bulk checkboxes are distinct native controls without nested buttons or links. Opening/selecting an item keeps keyboard focus predictable.

The evidence workspace prioritizes identity, current state, source/context and evidence. Use sections and dividers. Only render a timeline when the existing item contract supplies real events; never invent a lifecycle from missing data. Keep Discord source links close to their evidence and label absent/unavailable evidence explicitly.

The first reference milestone can demonstrate existing case/report/alert action groupings using inert callbacks. Labels must retain the meaning of real actions. Separate destructive actions, retain confirmation/reason steps where required, and show queued requests as pending rather than completed. An observed alert must not appear to have applied a case role or restriction unless the supplied state says so.

Show bulk actions when one or more items are checked. Preserve which items are checked when opening details. Clearing filters or changing selection must not silently execute or discard an action request.

Use a single-pane list/detail layout below the width at which both queue and evidence can remain readable, initially 1100px and adjusted only through actual viewport review. On narrow screens, selecting an item opens its detail pane with an explicit Back to inbox control. Preserve search, filters, checked IDs and list scroll position on return. Move focus to the detail heading on open and restore it to the originating row control on return. The mobile detail must not be appended beneath the whole queue.

At 320 CSS pixels, content reflows without horizontal page scrolling; long IDs/URLs and evidence wrap. Desktop-specific sticky regions must not obscure focused elements or prevent document scrolling at zoom.

## Story coverage

Foundations stories show both themes, the original logo at intended sizes, typography, semantic color pairs, focus styles and control states.

Queue and evidence stories cover mixed item kinds, selected/checked states, empty queue, no filter matches, long names/evidence, missing sources, unavailable actions and stale items. Feedback stories cover pending/succeeded/failed outcomes and explanatory text.

Reference inbox stories use existing deterministic fixtures for a mixed queue and selected case/report/observed alert. Add only fixture information supported by the contract. Demonstrate desktop and mobile selection/return flows and isolated pending/error states. No story calls real moderation endpoints.

## Verification and acceptance

- Build Storybook and run relevant web typecheck/lint/unit checks for changed code. Apply repository checks appropriate to actual scope.
- Exercise selection, filtering, checked-state preservation, mobile open/back focus restoration and action-feedback states through browser interaction tests. Reuse the project's Playwright setup instead of adding a competing test stack.
- Inspect reference screenshots at 1440px, 1024px, 390px and 320px in both themes. Test zoom and long content. Approve snapshots only after inspection.
- Check WCAG 2.2 AA text/control contrast, labels, keyboard access, visible/unobscured focus and reflow. Prefer 44px touch targets on mobile; do not confuse that project preference with the 24px AA minimum and its exceptions.
- Verify whether the current Storybook accessibility configuration actually executes checks. New stories need a functioning accessibility check, not merely the existing `test: 'todo'` setting.
- Verify that logo derivatives preserve the source artwork, and visually review their clarity at actual size. A generated mockup is never the logo source.
- Confirm existing production routes and action/auth contracts are untouched by this first milestone. Run existing affected checks if shared tokens or theme behavior change.

The reviewer should be able to select an item, read its evidence, understand its state and return to the queue using keyboard or touch. The first milestone is ready for route-adoption planning only after that working composition and the commissioned logo have been reviewed together.

## Research basis and next step

The initial research artifact is `/workspace/artifacts/drasil-foundation/research.md`. Mobbin references include the [Linear inbox](https://mobbin.com/screens/beb9d6b3-ec34-46d7-9332-320fcb32a338) and [Front conversation layout](https://mobbin.com/screens/f445cb7a-fbdf-4fba-96c1-aaa0f8e24c59). They inform structure, not brand assets.

Continue visual exploration with larger mockups and editable Figma designs. Let the user experiment with composition, typography, density and interactions, and revise these notes as the design develops. Do not treat the selected art direction or this document as design sign-off. The approved everyday Storybook slice can proceed alongside design exploration. Plan production adoption and broader workflows after further review.
