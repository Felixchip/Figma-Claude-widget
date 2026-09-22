# GSA Build Kit — progress and readiness

**Prepared for:** management review
**Version:** v0.3.0 · deployed and in internal testing
**Owner:** GSA / design system team

---

## In one paragraph

The GSA Build Kit lets our AI assistants (ChatGPT, Codex, Claude, Cursor) work
with our **real** design system. Instead of inventing buttons, colours and
spacing, they look up the actual GSA components, the approved design values, the
rules, and real pictures of every component. Designers and engineers get
on-brand work faster, and the design system finally reaches the tools people are
already using.

---

## The problem it solves

People have started using AI to build interface work. The output is quick but
often **off-brand and wrong**: components that don't exist, colours we don't use,
spacing that matches nothing.

The cause isn't the AI. It's that the AI can't see our design system — which
lives in Figma and in a private code repository. This project closes that gap.

**What good looks like:** someone asks for a watchlist screen and gets one built
from the same components our designers would use.

---

## What's working today

| | |
| --- | --- |
| **Connected to the real design system** | Components, variations, descriptions and approved design values, read live from Figma |
| **Connected to the code library** | The actual SwiftUI components from our design system repository |
| **Every component pictured** | 1,632 images covering all 544 components and their variations, in light and dark |
| **Clear rules for the assistants** | Brand, platform and per-component usage guidance, editable without a developer |
| **One connection, five tools** | ChatGPT, Codex, Claude, Claude Code and Cursor |
| **A ChatGPT plugin** | Installable in one click, currently in internal testing |
| **A browsing site** | A simple web app to view every component and manage the guidance |
| **Usage reporting** | Anonymous counts of what the assistants are looking up |

**Safety:** the Build Kit is **read-only**. It cannot change anything in Figma or
in the code repository. It only reads.

---

## Readiness at a glance

| Area | Status | Note |
| --- | --- | --- |
| Core capability | Ready | Working end to end, verified automatically after each release |
| ChatGPT plugin | Ready to share | Installable today; needs publishing to the CMC workspace |
| Content and rules | Ready | Editable by the team; no developer needed |
| Access control | In progress | Networks restricted; Library and Settings now behind a sign-in |
| Operational safeguards | In progress | No test environment, alerts or traffic limits yet |
| Editing accountability | Mostly there | Every change is now recorded against a name; everyone still shares one token |

**Recommendation:** suitable for a **controlled pilot (10–20 people)** now.
Not yet suitable for company-wide rollout until the three items in the next
section are closed.

---

## What's needed before wider rollout

| # | Item | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | **Add our corporate network ranges** | Access is limited to recognised networks. ChatGPT's ranges are handled automatically, but colleagues using Codex, Claude Code or Cursor connect from our own network, so those ranges must be added or they will be blocked. | 10 minutes |
| 2 | **Publish the plugin to the CMC workspace** | The one-click install link only works for the person who set it up. Publishing makes it available to colleagues. | 10 minutes |
| 3 | **Add a test environment** | So a bad update can't take the tool down for everyone, and we can undo it quickly. | Small |
| 4 | **Alerting when something breaks** | Today we'd find out when a user tells us. | Small |
| 5 | **Protect against heavy traffic** | Nothing currently limits usage from an allowed network. | Small |
| 6 | **Strengthen identity** | Changes are now recorded against a name, but names are self-declared and everyone shares one token. Per-person sign-in would make it verifiable. | Medium |
| 7 | **Reduce the cost of images** | Sending full images to the assistants uses more of their usage allowance than necessary. | Medium |

---

## Decision taken: access is restricted

We chose to **limit access to recognised networks** rather than leave the
service open.

**What this means in practice**

- ChatGPT's traffic is recognised automatically; the list is fetched from
  OpenAI's published ranges and refreshed twice a day, so it stays current.
- Traffic from anywhere else is refused, with a message that tells the caller
  their own address so it can be added if legitimate.
- Our own network ranges still need to be supplied. Until they are, colleagues
  using Codex, Claude Code or Cursor — which run on their own machines — will be
  blocked.

**Worth knowing**

- This controls *which networks* can reach the service, not *who* the person is.
  It reduces exposure; it does not replace sign-in.
- ChatGPT has to reach us from the internet, so we could not simply put this
  behind the corporate firewall.
- It is fully reversible: removing the configuration settings restores the
  previous behaviour.

**Still to decide:** whether we eventually need proper sign-in (item 7) on top of
this, which would give us accountability for who changes what.

---

## Also done: admin-only access to the team areas

The Library and Settings pages now sit behind an admin sign-in. The **password is
the admin token**, so only people who already have admin rights can see those
pages or change anything. It asks for a name as well, which is shown in the
header so we know who is using it.

The Overview page stays open, so anyone can read what the tool is and how to
connect.

This is on whenever an admin token is configured, and off when it isn't — no
separate password to manage, and no code change either way.

## Also done: an activity log

Every change now records **who made it**. The name comes from the sign-in, so
the list reads like "Xavier changed the preferred theme to Light" rather than
"someone with the token changed something". Changes made by the Figma plugin or
by a script are attributed to the admin token instead, so they are still
distinguishable.

It covers component rules, the foundation, the render guide, name matches, the
registry sync, the preferred theme, Figma connection changes, image uploads and
clears, render runs, and published specs.

You can read it in **Settings → Activity**, or by asking for the activity
endpoint.

**Still not full accountability:** the name is typed in at sign-in rather than
verified, and everyone shares the same token. It tells us who said they were
making a change. Per-person sign-in is item 6 above.

---

## What we'd improve next

- Make it clear when the component pictures are out of date (today someone has to
  remember to refresh them).
- Allow different defaults per team, rather than one setting for everyone.
- Make the website work properly on smaller screens.
- Add a "something's wrong" button so feedback comes straight to the team.
- Revisit the component-matching rules, which rely on names staying the same on
  both the Figma and code sides.

---

## Suggested next steps

1. **Get the exposure decision** (item 1) — it determines everything else.
2. **Ship the quick safety items** (2, 3, 6) — all reversible, none disruptive.
3. **Publish to the workspace and start the pilot** with a small group.
4. **Add the test environment and alerting** (4, 5) before the user count grows.
5. **Then** the accountability and cost work (7, 8).

---

## Background

- **Internal user guide:** `docs/ONBOARDING.md`
- **Technical detail:** `README.md`
- **The story so far, including the decisions and tradeoffs:** `docs/CASE-STUDY.md`
