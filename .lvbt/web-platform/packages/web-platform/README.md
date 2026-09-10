# Web platform operations

`@lvbt/web-platform` provides the provider-neutral operations used to inspect and reconcile LVBT web
infrastructure. Repository packages supply project discovery, naming, routes, and lifecycle policy.

The package reads external state separately from reconciliation. Every resource describes its
current and desired values, then `reconcileResources` reports or applies the smallest necessary
change. Doctor checks return structured results without mutating provider state.

Import GitHub operations from `@lvbt/web-platform/github`, Cloudflare operations from
`@lvbt/web-platform/cloudflare`, and the reconciliation contract from
`@lvbt/web-platform/provision`.
