# Loop Frame

An internal presentation tool for turning UI section screenshots into layered
section mockups — styled backdrop, cut or crossfade transitions, frame styling,
and export to looping GIF, video, or still.

Built with [Toolcraft](docs/toolcraft/). Distribution is the deployed app only —
this repo stays private. Do not resell or repackage the app as a standalone
product or template. Platform, template-marketplace, and resale uses require a
separate commercial license from Pixel Point — see [`LICENSE.md`](LICENSE.md).

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server picks a free port automatically.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Type-check and build for production |
| `pnpm preview` | Preview the production build |
| `pnpm test` | Run static checks and unit tests |
| `pnpm test:browser` | Run Playwright end-to-end tests |
| `pnpm typecheck` | Type-check only |
| `pnpm verify:quick` | AI/skill check + unit tests |
| `pnpm verify:final` | Full verification: unit tests, build, and e2e tests |

## Stack

React 19, Vite, TanStack Router, Tailwind CSS, Base UI, and `gifenc` for GIF encoding.

## Docs

See [`docs/product-spec.md`](docs/product-spec.md) for the product spec and
[`docs/toolcraft/`](docs/toolcraft/) for the internal component/runtime framework
this app is built on.
