# Update the repository standard

The LVBT web standard is committed under `.lvbt/web-platform/`. The adjacent
`.lvbt/web-platform.json` records its release tag, source commit, content hash,
and executable files. A checkout therefore validates its tooling without
network access or registry credentials.

## Review an update

Choose a tagged release from
[repository-tooling](https://github.com/LasVegasForTransit/repository-tooling/releases), then preview
the exact vendor changes:

```sh
pnpm standards:update --release <tag>
```

The command is a dry run unless `--apply` is present. It refuses moving branch
names, locally edited vendor files, invalid paths, and releases whose tag cannot
resolve to one commit.

Read the release note and inspect the planned additions, changes, and removals.
Framework or tool upgrades still receive their own review; a standard update
does not make product-specific decisions on their behalf.

## Apply and verify

```sh
pnpm standards:update --release <tag> --apply
pnpm install --frozen-lockfile
pnpm check
```

The file dependency paths in workspace manifests remain stable across releases.
When `.claude/settings.json` names the same repository-tooling tag for the
contribution plugin, update that ref in the same change.

Commit the vendor tree, metadata record, lockfile changes, and any required
repository integration together. A later `pnpm standards:check` rejects a
partial update or any unrecorded change to the vendored files.
