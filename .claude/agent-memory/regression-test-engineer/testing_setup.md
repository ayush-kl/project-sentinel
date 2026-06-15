---
name: testing-setup
description: How Vitest is wired into the Project Sentinel monorepo — runner commands, conventions, and the ESM import-extension gotcha
metadata:
  type: project
---

Project Sentinel uses **Vitest** (`describe`/`it`/`expect`), colocated `*.test.ts` beside the source. Mandated by CLAUDE.md (strict TS, ESM).

**Runner commands**
- Root fan-out: `npm run test` → `npm run test --workspaces --if-present`.
- Each workspace's `test` script is `vitest run`.
- Single file: `npx vitest run <path>` (must run from inside the workspace; the include glob is workspace-relative, so a `/tmp` path yields "No test files found").
- Gate before commit: `npm run typecheck && npm run test`.

**Vitest version:** `^2.1.9` (compatible with Node >=20, the repo's engine floor). Added as a devDependency in each workspace that has tests.

**ESM import-extension gotcha (load-bearing):**
- `services/*` are `"type": "module"` with `moduleResolution: "Bundler"` in tsconfig.base.json. Service test imports must use the **`.js` extension** even for `.ts` source: `import { x } from "./incidents.js"`. This matches how the service code imports itself and typechecks clean.
- The `app` workspace (Next/Bundler) imports **without** extension: `import { x } from "./sentinel"`.
- No vitest.config needed for either — pure unit tests, no DOM. Keep config minimal.

**tsconfig:** every workspace extends `tsconfig.base.json`; `strict` + `noUncheckedIndexedAccess` are on and must not be weakened. Because of `noUncheckedIndexedAccess`, destructure-and-optional-chain in tests (`const [d] = classify(...); expect(d?.status)`) rather than `arr[0]!`.
