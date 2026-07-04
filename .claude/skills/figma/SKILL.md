---
name: figma
description: Inspect actual Figma node, layer, component, variable, and asset structure through Figma MCP before implementing Figma-referenced apps.
---

# Figma

When a Figma URL is provided:

1. Use Figma MCP tools (get_design_context, get_metadata, get_screenshot) to read the real node structure.
2. Extract layout, variables, components, and assets from the file, not from screenshots.
3. Screenshots are only for final visual QA, never the source of truth.
