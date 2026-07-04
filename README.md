# Layered GIF Creator

A browser-based tool for compositing layered images (background, foreground, text)
into looping GIF/video exports — built to showcase section UI from web designs.

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
