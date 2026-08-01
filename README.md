# Greener Pastures

A browser-playable implementation of **Greener Pastures**, a 1-4 player gateway-plus card game
about farms that cannot run alone.

You farm one crop. Your neighbours farm the others. The way to make money is to own the thing
your neighbours want to use, so the whole island competes to be the farm everyone needs.

> **Status: early scaffolding.** Nothing is playable yet.

## What this repo is

Three units, one rules engine:

| Package           | What it is                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `packages/engine` | The rules. Framework-free TypeScript, no DOM and no Node. Runs anywhere.        |
| `packages/ui`     | The React front end. Ships to GitHub Pages.                                     |
| `packages/sim`    | A headless Node simulator that plays thousands of games and reports on balance. |

The engine is the point of the split. The browser and the simulator run the _same_ rules code, so
a balance report is a report about the game people actually play, not about a second
implementation that drifted.

## Getting started

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Vite dev server for the front end                 |
| `npm run build`     | Production build into `packages/ui/dist`          |
| `npm run preview`   | Serve the production build locally                |
| `npm run sim`       | Run the headless simulator                        |
| `npm test`          | Run the test suite                                |
| `npm run typecheck` | Typecheck all three packages                      |
| `npm run lint`      | Lint, including the engine import boundary        |
| `npm run format`    | Format with Prettier                              |
| `npm run check`     | Everything CI runs: format, lint, typecheck, test |

## The engine boundary

`@gp/engine` may not import React, the DOM, Node built-ins, or the other two packages. Three
things enforce that rather than one, because a boundary held up by good intentions does not hold:

1. The engine's `package.json` declares zero dependencies.
2. The engine's `tsconfig.json` omits the `DOM` lib and all `@types`, so `document` or `process`
   fail typecheck.
3. An ESLint `no-restricted-imports` rule catches the rest.

## Deployment

Pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml`. The
production build is served from `/greener-pastures-web-game/`, which is why `vite.config.ts` sets
a `base` for builds but not for dev.

## Design source

The game design lives outside this repo and is not tracked here.
