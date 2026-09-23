# Web platform operations

`@lasvegasfortransit/web-platform` provides the provider-neutral operations used to inspect and
reconcile LVBT web infrastructure. Repository packages supply project discovery, naming, routes, and
lifecycle policy.

The package reads external state separately from reconciliation. Every resource describes its
current and desired values, then `reconcileResources` reports or applies the smallest necessary
change. `reconcileResourceGroups` preserves the same fail-closed planning boundary within ordered
dependency stages, such as repository creation before ruleset and environment configuration. Doctor
checks return structured results without mutating provider state.

Import GitHub operations from `@lasvegasfortransit/web-platform/github`, Cloudflare operations from
`@lasvegasfortransit/web-platform/cloudflare`, and the reconciliation contract from
`@lasvegasfortransit/web-platform/provision`.
