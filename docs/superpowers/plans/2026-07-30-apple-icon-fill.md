# Apple Icon Mark Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge the Apple-only Route silhouette so the 180px touch icon has a 16dp left and right inset.

**Architecture:** Keep browser and manifest icon scales unchanged. Give the Apple Icon Composer input layer a dedicated `1.0` scale, verify its rendered alpha bounds as image behavior, then re-export and record the native Liquid Glass result.

**Tech Stack:** TypeScript ESM, Sharp, Vitest, Apple Icon Composer, pnpm

---

### Task 1: Lock the Apple silhouette inset

**Files:**

- Create: `apps/web/tests/scripts/app-icon.test.ts`
- Modify: `apps/web/scripts/app-icon.ts`

- [ ] **Step 1: Write the failing rendered-image test**

Create `apps/web/tests/scripts/app-icon.test.ts`:

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { appleTouchIconLayerPng } from '../../scripts/app-icon';

interface HorizontalInsets {
  left: number;
  right: number;
}

async function horizontalAlphaInsets(image: Buffer): Promise<HorizontalInsets> {
  const { data, info } = await sharp(image)
    .resize(180, 180)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minimumX = info.width;
  let maximumX = -1;

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * 4 + 3] <= 8) continue;
    const x = pixel % info.width;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
  }

  if (maximumX < 0) throw new Error('Apple icon layer has no visible pixels.');
  return {
    left: minimumX,
    right: info.width - 1 - maximumX,
  };
}

describe('Apple icon layer', () => {
  it('keeps the Route silhouette within its 16dp horizontal inset', async () => {
    const insets = await horizontalAlphaInsets(await appleTouchIconLayerPng());

    expect(insets.left).toBeGreaterThanOrEqual(15);
    expect(insets.left).toBeLessThanOrEqual(17);
    expect(insets.right).toBeGreaterThanOrEqual(15);
    expect(insets.right).toBeLessThanOrEqual(17);
  });
});
```

- [ ] **Step 2: Run the test and verify the current mark fails**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/scripts/app-icon.test.ts
```

Expected: FAIL because the existing `0.88` browser scale leaves about 25px of
horizontal inset in the 180px render.

- [ ] **Step 3: Add the dedicated Apple scale**

In `apps/web/scripts/app-icon.ts`, add the Apple-only constant beside
`GLYPH_SCALE` and use it only in `appleTouchIconLayerSvg()`:

```ts
const APPLE_GLYPH_SCALE = 1;
```

```ts
const transform = `translate(${GLYPH_OFFSET} ${GLYPH_OFFSET}) translate(12 12) scale(${APPLE_GLYPH_SCALE}) translate(-12 -12) rotate(45 12 12)`;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/scripts/app-icon.test.ts
```

Expected: PASS with a 15–17px inset on both sides.

- [ ] **Step 5: Commit the tested generator change**

```bash
git add apps/web/scripts/app-icon.ts apps/web/tests/scripts/app-icon.test.ts
git commit -m "fix(web): enlarge Apple icon mark"
```

### Task 2: Re-export the Liquid Glass icon

**Files:**

- Modify: `apps/web/scripts/transit-mapper.icon/Assets/apple-touch-icon-layer.png`
- Modify: `apps/web/scripts/apple-touch-icon-source.png`
- Modify: `apps/web/scripts/apple-touch-icon-provenance.json`
- Modify: `apps/web/public/apple-touch-icon.png`
- Modify: `docs/development/how-to/update-application-icons.md`

- [ ] **Step 1: Generate the enlarged Icon Composer layer**

Run:

```bash
pnpm --filter @transitmapper/web generate:icons
```

Expected: the command updates
`apps/web/scripts/transit-mapper.icon/Assets/apple-touch-icon-layer.png`, then
stops with the expected stale-export message because the native export still
contains the old silhouette.

- [ ] **Step 2: Export the native source**

Open `apps/web/scripts/transit-mapper.icon` in Apple Icon Composer. Export a
flattened 1024px PNG over
`apps/web/scripts/apple-touch-icon-source.png`, preserving the existing Ember
fill, Combined lighting, neutral shadow, and 0.5 translucency.

- [ ] **Step 3: Record provenance and regenerate the public asset**

Run:

```bash
pnpm --filter @transitmapper/web generate:icons -- --record-apple-export
```

Expected: the command records the current document, enlarged layer, and
flattened export, then updates `apps/web/public/apple-touch-icon.png`.

- [ ] **Step 4: Document the platform-specific sizing contract**

Add this paragraph to the Apple Icon Composer section of
`docs/development/how-to/update-application-icons.md`:

```md
The Apple-only Route layer uses a 16dp left and right inset in the 180px touch
icon. Browser and manifest icons keep their independent regular and maskable
scales; changing the Apple inset must not resize those assets.
```

- [ ] **Step 5: Verify generated assets are stable**

Run:

```bash
pnpm --filter @transitmapper/web generate:icons
pnpm --filter @transitmapper/web generate:icons -- --check
```

Expected: both commands succeed without changing files.

- [ ] **Step 6: Inspect the generated Apple icon**

Open `apps/web/public/apple-touch-icon.png` and confirm that the Route
silhouette fills more of the Ember square, retains one continuous Liquid Glass
surface, and leaves visually balanced side insets.

- [ ] **Step 7: Commit the native export and documentation**

```bash
git add apps/web/scripts/transit-mapper.icon/Assets/apple-touch-icon-layer.png \
  apps/web/scripts/apple-touch-icon-source.png \
  apps/web/scripts/apple-touch-icon-provenance.json \
  apps/web/public/apple-touch-icon.png \
  docs/development/how-to/update-application-icons.md
git commit -m "fix(web): refresh Apple Liquid Glass icon"
```

### Task 3: Run the repository gates

**Files:**

- Verify only

- [ ] **Step 1: Run the complete check**

Run:

```bash
pnpm check
```

Expected: formatting, lint, typecheck, tests, and repository invariants pass.

- [ ] **Step 2: Build and verify production PWA output**

Run:

```bash
pnpm build
pnpm --filter @transitmapper/web exec tsx scripts/perf/verify-pwa-output.ts
```

Expected: the build and PWA output verifier pass.

- [ ] **Step 3: Confirm the branch contains only the intended change**

Run:

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: a clean `codex/apple-icon-fill` branch containing the design,
implementation, generated Apple assets, and documentation commits only.
