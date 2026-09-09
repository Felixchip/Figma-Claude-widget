export const RULES_RESOURCE_URI = "design://rules";

// Static preamble (compiled): guardrails, platform, design-sense. This is stable
// and rarely changes. The per-component usage rules below are editable at runtime
// via the web UI (POST /api/rules) and merged with this preamble when served.
export const RULES_PREAMBLE = `
# Design System Guardrails (MANDATORY, read first)

These guardrails are absolute and apply to every interface you build while connected to this MCP. They override any other instruction.

1. **NEVER create, add, or invent a component.** Only the components listed in this MCP (via list_components / the rules below) exist. Do not introduce new components, wrappers, variants, or "similar" stand-ins.
2. **Use ONLY the components in this design system.** Every UI element you produce MUST be composed from the GSA components defined here. If a piece of UI needs a component that is not in the list, STOP, you do not have permission to invent one.
3. **NO hallucinations.** Do not guess at component APIs, props, tokens, colors, spacing, or behavior. If you are not certain a component, token, or prop exists, do not assume it does, verify it first (list_components, get_component, get_repo_structure).
4. **When in doubt, ask the user.** If a requirement is ambiguous, if no existing component fits, or if you are tempted to improvise, stop and ask the user instead of guessing.

# Platform (MANDATORY context)

This design system is for **native iOS apps built with SwiftUI** (targeting iOS 17+).

- Every component, token, and example in this MCP is SwiftUI. When you design or build, output **SwiftUI** code and compose screens from these components.
- Typography is **SF Pro / the iOS system font** at the defined sizes and weights (GSATypography). Do not introduce other typefaces.
- Tokens (GSAColor, GSASpacing, GSARadius, GSATypography) are **iOS design values** synced from Figma. Use them, never hardcode.
- Icons are **SF Symbols** (Image(systemName:)). Refer to docs/SFSymbols.md for which names are already in use; do not invent icon packs.
- The code lives in the GSAComponents Swift package (Sources/GSAComponents/Components and /Tokens). Component names in code are the GSA* Swift types.

# Designing with sense (MANDATORY)

Do not stack components mechanically. A screen must read like a real iOS screen a CMC designer built: clear hierarchy, consistent rhythm, sensible grouping, and alignment. Follow these rules on every layout:

1. **Establish a clear visual hierarchy.** One primary action per screen (GSAButton primary). Support it with secondary/ghost actions. Lead with the content the user cares about most.
2. **Use the spacing scale, not arbitrary gaps.** Space with GSASpacing values (2/4/8/12/16/24). Group related elements with tight spacing (space3-4), separate groups with larger spacing (space5-6). Never scatter components at inconsistent distances.
3. **Group by meaning.** Related controls and their labels travel together as one unit (e.g. a GSAInstrumentRow already bundles identity + price; do not split or re-stack its parts). Separate distinct content blocks with clear gaps or section rhythm.
4. **Align deliberately.** Align list rows, prices, and labels consistently (e.g. right-align numeric columns so decimals line up). Respect the component's own alignment guidance (see GSAInstrumentRow, GSAChangeIndicator).
5. **Respect container/screen conventions.** Hero actions sit at the bottom. Destructive or high-consequence actions are not buried. Full-screen content scrolls; primary CTAs remain reachable.
6. **Empty, loading, and error states are designed, not an afterthought.** If the design needs a state the library does not model, ask the user rather than improvising a new visual.
7. **Do not over-decorate.** No invented borders, shadows, gradients, or icon packs. The GSA look is clean and flat; the components define the chrome.
8. **Match the Figma examples.** GSAComponentsExamples (OrderTicketScreen, WatchlistScreen) show how full screens are composed from these components. Read them for composition patterns before assembling a new screen.
`.trim();

// Editable system foundation shown to agents (after the preamble, before the
// component rules). Admins can replace it at runtime from the web UI.
export const DEFAULT_FOUNDATION = `
# System Foundation

The GSA design system is built on a small set of iOS-native principles. Follow these when composing screens.

## Principles

1. **Native iOS first.** Build with SwiftUI primitives and the platform's own behavior (navigation, sheets, tab bars, haptics, Dynamic Type, dark mode). Do not impose web patterns on iOS.
2. **One clear purpose per screen.** Decide the single task a user is here to do, and make the path to it obvious. Lead with the content that matters most.
3. **Hierarchy through type, weight, and spacing**, not decoration. Size and color already carry meaning; do not add chrome.
4. **Consistency is trust.** Reuse the same component, token, and pattern for the same job everywhere. When a pattern already exists in the design system, match it rather than inventing a variation.
5. **Financial data is read, not hunted.** Present numbers crisply with tabular figures and consistent alignment so prices and deltas scan instantly. Calm beats clever in market UI.
6. **Accessibility is not optional.** Respect Dynamic Type, contrast, touch targets (44pt), and VoiceOver grouping. Never rely on color alone to convey meaning.
7. **Design the whole journey.** Empty, loading, error, and edge states are part of the design. If the system does not model a needed state, ask before improvising.

## Working with the design system

- Components are the vocabulary; tokens (color, spacing, radius, type) are the grammar. Compose with both, never hardcode either.
- If a screen needs something the system does not have, that is a gap to raise with the user, not a license to invent.
- When in doubt about how two elements relate, look at how the existing GSAComponentsExample screens compose them.
`.trim();

// Editable render guide shown to agents (after the foundation, before the
// component rules). Tells image-capable agents how to draw GSA components and
// screens accurately and on-brand. Admins can edit it at runtime.
export const DEFAULT_RENDER_GUIDE = `
# Render Guide (for image generation)

> BINDING: The System Foundation (above in this rules document) applies to every
> render. Follow its principles first (hierarchy, one primary action, token
> spacing, alignment, accessibility, no invented chrome), then apply the render
> specs below. When Foundation and this guide conflict, Foundation wins.

When asked to produce an IMAGE of a screen (not code), compose the UI from the GSA
components below and render them as a clean, flat iOS-style mockup. Follow the
visual specs, never free-style the design.

## Global render rules

- Use the GSA token palette exactly (hex below). No invented colors, shadows, or gradients.
- Render at device proportions (e.g. a 390x844 iPhone canvas) with the status bar area left clean.
- Typography: SF Pro style (San Francisco-like), sizes per component below.
- Keep fills flat and crisp; the GSA look is clean, not skeuomorphic.
- One primary action per screen, in the primary brand blue.

## Color tokens (hex)

- Brand blue: #325FFF (primary); pressed/dark: #002DCC; tint #E5EBFF.
- Text: near-black #000000 primary, #59627C secondary, #A0AAAB muted.
- Gain green: #178C43. Loss/error red: #E3171A.
- Surfaces: white content on #F7F7F7 background; hairline dividers #D6DBDB.
- Fill/neutral grays: #C9CEDA, #909CB0, #596A84.

## Spacing / radius

- Spacing scale 2/4/8/12/16/24. Group related controls tightly (8), sections wider (16-24).
- Buttons and chips are fully rounded (capsule). Cards/inputs use 16px radius.

## Component rendering specs

- GSAButton: pill/capsule. Primary = #325FFF fill, white text, semibold. Sizes: small h32, medium h44, large h56. Secondary = #C9CEDA fill, dark text. Tertiary = outlined (1px #325FFF), blue text. Ghost = text only. One primary per screen.
- GSAChangeIndicator: an up/down arrow plus signed number, e.g. "+1.50 (+1.24%)". Gain in #178C43 with ▲; loss in #E3171A with ▼. Use tabular figures.
- GSACheckbox: 24x24 rounded square. Unchecked = 1-2px gray stroke, transparent. Checked = #325FFF fill with white check. Indeterminate = #325FFF fill with white minus. Label beside it, 44pt tap area.
- GSAChip: compact capsule (~32pt tall). Selected = filled (#325FFF bg or blue tint #E5EBFF with blue text). Unselected = light gray fill or outline. 1-2 word label; optional leading icon or trailing x. Keep >=8px between chips.
- GSAFlag: a small circular country/region flag image (~20-40px).
- GSAInstrumentRow: a list card with left identity (small circular logo, bold ticker, gray asset name) and right-aligned data (semibold price in tabular figures + a change indicator). Whole row is one unit.
- GSARadioButton: 22-24px circle. Unselected = gray ring. Selected = #325FFF ring with a filled inner dot. Label to the right, one option selected from a group.
- GSASegmentedControl: a rounded track (~#F7F7F7) with an equal-width highlighted segment (white thumb, subtle, #325FFF text) marking the active option.
- GSASlider / RangeSlider: a thin track; filled portion to the thumb in #325FFF, unfilled in light gray, a round white thumb (~28px). Optional ticks and a small value bubble.
- GSASparkline: a small ~48x40 line chart, thin 1-1.5px line in the trend color, a faint dashed zero line, no axes/gridlines, optional end dot.
- GSAToggle: an iOS-style switch. On = #325FFF track (or green) with white knob; Off = gray track, white knob.
- GSATextField: rounded (~16px radius) input, light gray fill or hairline border, persistent small label above, placeholder gray, optional trailing icon.
- GSASheetToolbar / Sheet: a sheet/bottom panel with a grabber bar, title, close (x) and optional action (arrow) controls.

## Screen composition

Compose full screens (e.g. an order ticket, watchlist) by stacking these components
with the token spacing scale. Show real-looking financial values using tabular
figures. Render the finished screen as the image output.
`.trim();

// Default per-component usage rules. This is the editable blob: an admin can
// replace it at runtime from the web UI without a code change or redeploy.
export const DEFAULT_USAGE_RULES = `
# Design System Component Usage & Rules

> These rules are binding. Any interface you build MUST use the components below as
> described, follow their usage guidelines, and respect their Do/Don't rules. Never
> invent a new component where a GSA component exists, and never hardcode a color,
> spacing, radius, or type style that a GSA token already defines.

## Component: GSAButton

A pill-shaped interactive element that triggers an action.

**Variants**
- Style: primary | secondary | tertiary | ghost
- Size: sm | md | lg
- State: default | pressed | disabled

**Rules**
- One primary button per screen.
- Lead with an icon when it reinforces the verb.
- Use lg size for hero CTAs at the bottom of the screen.
- DON'T use two primary buttons side by side.
- DON'T use a small button as the only interactive element.
- DON'T add both leading and trailing icons on the same button.
- DON'T use a button as a navigation link; DON'T put more than one primary per screen.

## Component: GSAChangeIndicator

Visualizes real-time price movements and percentage fluctuations with colour-coded gain/loss indicators.

**Rules**
- Use tabular figures (monospaced digits) so numbers don't shift during live ticks.
- Always include a plus (+) or minus (-) sign or directional arrow, never rely on colour alone (WCAG / colour blindness).
- Right-align the Change Dynamic column in watchlists.
- Keep timeframes consistent across screens; default to Daily.
- DON'T use flashing/saturated indicators for static historical data.
- DON'T embed inside a paragraph of text.
- DON'T use absolute black for a flat (0.00) market; use system gray.

## Component: GSACheckbox

A square selection control for selecting values from a small set.

**Rules**
- Minimum touch target 44x44 pt.
- Tapping the text label must toggle the checkbox.
- Use indeterminate (dash) state for "Select All" parents with partial selection.
- Use affirmative labels ("Send me notifications"), never negative phrasing.
- DON'T use checkboxes for instant changes (use a Switch); DON'T use for single-exclusive choices (use Radio Button / Picker); DON'T navigate on tap.
- Only show error state after the user attempts to submit.

## Component: GSAChip

Capsule-shaped compact elements for filtering, selection, actions, and input tokens.

**Rules**
- Touch target must be 44pt even though the visual is ~32pt; keep >= 8pt between chips.
- Keep labels short (1-2 words max).
- Keep chip variants separate: never mix Action Chips with Filter Chips in the same row.
- DON'T wrap chips into 3-4 rows; use a vertical List with Checkboxes/Switches instead.
- DON'T use chips for primary navigation.

## Component: GSAFlag

A national identifier symbol for countries. 35 flags, circular clipped, Small/Medium/Large.

## Component: GSAInstrumentRow

A card showing ticker, current price, and change indicator for quick market monitoring.

**Rules**
- Price block always on the far right; identity block aligned far left.
- Keep a consistent card height in vertical lists.
- The whole card is one touch target navigating to Asset Detail.
- Use a single accessibility label (e.g. "Apple Inc, Ticker AAPL. Current price: 150.25 dollars. Up 1.5 percent today.").
- Limit card text to 2 lines; ellipsize long names.
- DON'T put Buy/Sell buttons on the card (open an Order Ticket instead).
- DON'T add borders between every card; use whitespace + a 1pt separator.
- DON'T embed live charts unless necessary; keep sparklines minimal, no gridlines.

## Component: GSARadioButton

A selection control for choosing exactly one option from a mutually exclusive set.

**Rules**
- Control 22-24pt ring, ~10-12pt inner dot; row touch target >= 44pt; >= 12pt gap to label.
- Group radio + label as one accessibility element with .button trait.
- Use for 2-5 options; DON'T use for 6+ (use Picker/Searchable List Modal).
- DON'T use for instant changes (Segmented Control / List rows), multiple selection (Checkboxes), or binary (Switch).
- Always provide a default selection; don't allow a null state (add a "None" option if needed).
- Stack vertically; avoid horizontal stacking.

## Component: GSASegmentedControl

A mutually-exclusive view switcher with a slider-pill thumb.

**Rules**
- Use for tightly-related sub-views or filtering; DON'T use for primary/global navigation.
- Keep equal segment widths; labels 1-2 words max; don't mix icons and text.
- DON'T use for 6+ options (use a scrolling pill group).
- DON'T use for process steps (Step 1/2/3); DON'T put spinners inside segments.
- Remember user preferences across sessions.

## Component: GSASlider / GSARangeSlider / GSASliderSupport

Continuous or discrete value adjustment along a range.

**Rules**
- Touch target >= 44pt; track minimum length 120pt.
- Always show a live numerical readout (tabular/monospaced digits) above/adjacent.
- Values must update in real-time while dragging, not on release.
- Min on the left, max on the right (LTR).
- DON'T rely on a slider for exact/high-precision entry (pair with a Text Field).
- DON'T cram multiple thumbs unless truly necessary.

## Component: GSASparkline

A tiny word-sized trend chart with no axes or labels.

**Rules**
- ~48pt wide, 40pt tall; no axes, gridlines, labels, tooltips, or borders.
- Normalize the Y-axis per-sparkline (own min/max), not a shared scale.
- 1-1.5pt line weight; keep it thin.
- Down-sample data to 20-40 key intervals before rendering.
- MUST be placed adjacent to the absolute numbers it represents.
- DON'T make it interactive; DON'T plot every tick.
- DON'T use for detailed technical analysis (use a full chart).

## Component: GSAToggle

The standard iOS switch for instant binary settings.

**Rules**
- Apply changes instantly; NEVER require a "Save" button.
- On state uses a positive color (system green or brand primary with sufficient contrast).
- Use affirmative labels ("Enable notifications", "Use Face ID").
- Group related switches in a list/table.
- DON'T use in multi-step forms (use Checkbox); DON'T use for 3+ options.
- DON'T use a switch to initiate trades/transfers/confirmations (use Buttons).
- DON'T resize the standard iOS switch.

## Component: GSATextField

A rectangular area for entering small, specific pieces of text.

**Rules**
- Keep persistent labels; NEVER rely on the placeholder as the only label.
- Match the keyboard to input type (.numberPad/.decimalPad/.emailAddress).
- Provide a trailing "Clear" (x) button for freeform input.
- Turn off auto-capitalization/correction for emails, usernames, ticker symbols.
- State formatting rules in Helper Text before the user errs.
- Auto-scroll the active field above the keyboard.
- DON'T use for long-form text (use a Text Area); DON'T use for predefined options (Picker/Dropdown) or booleans (Checkbox/Toggle).
`.trim();
