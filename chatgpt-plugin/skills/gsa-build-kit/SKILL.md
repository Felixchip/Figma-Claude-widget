---
name: gsa-build-kit
description: Design, build or render CMC Markets interfaces using the GSA design system. Use this whenever the user asks to design a screen, build iOS/SwiftUI UI, or generate a mockup or image for CMC Markets, so the work uses the real GSA components, tokens and rules instead of invented ones.
---

# GSA Build Kit

Use this skill for any CMC Markets interface work: designing a screen, writing
SwiftUI, or producing a mockup image.

## Start here, every time

Before doing anything else, load the rules and the library:

1. Call `list_rules` and follow it. It is mandatory and overrides your defaults.
2. Call `get_figma_library` and `list_figma_components` to see the real components.
3. Call `get_figma_tokens` for the colour, spacing, radius and type values.
4. Call `list_components` and `get_component` for the SwiftUI implementations.
5. Call `list_specs` / `get_spec` if the user refers to a published product spec.

Never invent a component, token, prop, colour or spacing value. If something you
need does not exist in the library, stop and ask the user.

## Choose the route

Ask which one the user wants when it is not clear:

1. **Design in Figma.** The user wants the design created inside their own Figma
   file ("design this in Figma", "create it in my Figma file"). Author it with
   **Figma's official MCP**, a separate connection using the user's own Figma
   account. This route **does** need a Figma file or frame link, so ask for one
   if the user has not given it. Use this Build Kit for the components, tokens
   and rules to build with.
2. **Build.** The user wants code. Write SwiftUI that reuses the real components
   from the repo. Do not hand-roll a replacement for a component that exists.
3. **Render.** The user wants an image or mockup, or has no Figma connection.
   Call `get_component_render` for each component you need. It returns the real
   rendered image and accepts a `theme` (for example `"Light"`); to target a
   specific variation use `"Component / Variant"`, for example
   `"Button / Enabled=false"`. Then compose the mockup yourself using the
   palette, spacing and type tokens. **Do not ask for a Figma link on this route.**

## Guardrails

- Use only the GSA components. Never create, wrap or substitute one.
- Verify before you assert: components, props and tokens must come from the tools.
- One primary action per screen, spaced with the token scale, aligned deliberately.
- Design the empty, loading and error states, or ask the user how they should look.
- When in doubt, ask. Do not guess.
