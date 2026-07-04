---
name: browser
description: Verify the generated UI in a running local browser after implementation, driving the real app rather than relying on typecheck/build output.
---

# Browser

1. Start the app with `pnpm dev` (or reuse the saved port).
2. Drive the real UI: upload/clear media, adjust controls, check canvas output, exports, timeline/layers when enabled.
3. Use the agent-controlled browser when available; `pnpm test:browser` is the default automated gate.
