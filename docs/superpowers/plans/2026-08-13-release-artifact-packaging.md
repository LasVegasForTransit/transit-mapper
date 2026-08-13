# Release artifact packaging implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production deployment package and deploy the actual Worker entry that Wrangler emits.

**Architecture:** `.github/workflows/deploy-production.yml` will archive all files in Wrangler's dry-run output, not a presumed filename. The deploy step will rediscover the one top-level JavaScript entry in the extracted, attested archive, so the bytes attested are the bytes deployed.

**Tech Stack:** GitHub Actions shell, pnpm, Wrangler, tar.

---

### Task 1: Preserve and select Wrangler's generated bundle

**Files:**

- Modify: `.github/workflows/deploy-production.yml:110-125`
- Modify: `.github/workflows/deploy-production.yml:174-180`

- [ ] **Step 1: Reproduce the current output contract**

Run:

```bash
pnpm run build
bundle_dir=$(mktemp -d /tmp/transitmapper-bundle.XXXXXX)
pnpm --filter @transitmapper/worker exec wrangler deploy --dry-run --outdir "$bundle_dir"
find "$bundle_dir" -maxdepth 1 -type f -print | sort
```

Expected: the directory contains `entry.js`, `entry.js.map`, and `README.md`,
not `index.js`.

- [ ] **Step 2: Change packaging to archive the complete Worker output**

Replace the single `cp "$RUNNER_TEMP/transitmapper-worker/index.js" ...`
operation with a recursive copy of `$worker_bundle/.` to
`$payload/apps/worker/dist/`. Before the copy, use `find` to collect top-level
`.js` files excluding `.js.map`, and fail unless exactly one entry is found.

- [ ] **Step 3: Change deployment to rediscover the archived entry**

Before `wrangler deploy`, collect the same non-source-map JavaScript entries
under `$DEPLOY_ROOT/apps/worker/dist`, fail unless exactly one is present, and
pass that discovered file path to `wrangler deploy --no-bundle`.

- [ ] **Step 4: Verify the packaging regression is green**

Run the build and dry-bundle commands from Step 1, copy the whole output
directory into a temporary payload, tar and extract it, and verify the
discovered entry exists in the extracted payload.

- [ ] **Step 5: Run repository validation**

Run:

```bash
pnpm check
```

Expected: exit 0.

- [ ] **Step 6: Commit the repair**

Stage only the workflow and documentation that describe the packaging
contract. Create a conventional `ci`-scoped commit with the repository hook
enabled.
