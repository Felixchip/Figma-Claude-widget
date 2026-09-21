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
| Access control | Decision needed | See "Decision needed" below |
| Operational safeguards | In progress | No test environment, alerts or traffic limits yet |
| Editing accountability | Not started | Anyone with the admin password can edit, with no record of who changed what |

**Recommendation:** suitable for a **controlled pilot (10–20 people)** now.
Not yet suitable for company-wide rollout until the three items in the next
section are closed.

---

## What's needed before wider rollout

| # | Item | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | **Decide who can reach it** | The service is currently open to anyone with the address. It exposes our design system and our component code, which today sits in a private repository. This needs a decision from the design system owner and security. | Decision |
| 2 | **Publish the plugin to the CMC workspace** | The one-click install link only works for the person who set it up. Publishing makes it available to colleagues. | 10 minutes |
| 3 | **Lock the website behind a login** | The browsing site is also open. A simple shared login is enough to start. | Small |
| 4 | **Add a test environment** | So a bad update can't take the tool down for everyone, and we can undo it quickly. | Small |
| 5 | **Alerting when something breaks** | Today we'd find out when a user tells us. | Small |
| 6 | **Protect against heavy traffic** | Nothing currently limits usage of the public address. | Small |
| 7 | **Record who changes the guidance** | One shared password means no accountability and no way to undo a bad edit. | Medium |
| 8 | **Reduce the cost of images** | Sending full images to the assistants uses more of their usage allowance than necessary. | Medium |

---

## Decision needed

**How open should this be?**

The service must be reachable from the internet for ChatGPT to use it — ChatGPT
runs in the cloud, not on our network. So we cannot simply put it behind the
corporate firewall.

There are three realistic options:

1. **Leave it open (read-only).** Simplest. Accepts that our design system and
   component code are publicly readable.
2. **Restrict it to recognised AI traffic.** Reduces casual access but not to
   zero, and it blocks nothing if the address leaks.
3. **Require proper sign-in.** The most secure, and the most work — it needs our
   identity provider and a few days of build.

**We need:** a decision and a named owner. Everything else on the list is
implementation.

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
