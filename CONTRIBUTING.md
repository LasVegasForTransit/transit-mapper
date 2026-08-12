# Contributing to TransitMapper

Thanks for thinking about contributing! TransitMapper is a project by
[Las Vegans for Better Transit](https://lasvegasfortransit.org), and it needs
more than code: riders, planners, designers, and anyone with local transit
knowledge can all help. If you're unsure whether something is worth
raising, raise it anyway.

## How to contribute

- **Report a bug.** Open a [GitHub issue](https://github.com/LasVegasForTransit/transit-mapper/issues/new)
  describing what you did, what you expected, and what happened instead.
- **Suggest an idea.** Check [ROADMAP.md](ROADMAP.md) to see if it's
  already planned, then open an issue either way.
- **Share transit knowledge.** If you know a city's real routes, stations,
  or streets well, that context is genuinely useful, even without writing
  any code.
- **Improve the documentation.** The guides in [`docs/`](docs/README.md)
  can always get clearer.
- **Submit a pull request.** See below.

## Submitting a pull request

See [Set up a local development environment](docs/development/how-to/local-development.md)
to get the project running and know what to run before opening a pull
request. Keep each pull request focused on one change, and if it affects
how something looks or behaves in the editor, say how you checked it in
the description. TransitMapper is in open beta, so current behavior and data
formats are not a stable compatibility promise.

Pull requests land by rebase merge, so your commits reach `main` exactly
as you wrote them — see [the enforcement
model](docs/development/explanation/enforcement-model.md#merge-method)
for why. A `feat` commit is reserved for a capability a person can use or
observe; use `refactor`, `perf`, `test`, or `chore` for internal preparation.
See [commit messages](docs/development/reference/commit-messages.md) for the
reasoning and examples.

Scope is optional. When a commit is confined to a durable boundary, use only
`web`, `worker`, `core`, `pwa`, `dx`, `tooling`, or `ci`; omit it for
cross-boundary work rather than inventing a scope from a feature, file, task,
or contributor role.

The organization template asks for a TL;DR, an overview, and optional
follow-ups. Fill those sections with complete, direct prose: lead with the
outcome for a person using TransitMapper, then explain the important constraint
or trade-off a reviewer needs to understand. Do not turn the description into
a file inventory, a walk through the diff, or a list of implementation
abstractions.

Follow-ups are optional and must be objectives, not chores. A useful item says
what unfinished user, reliability, or product outcome remains, such as
"Render metric curves and watertight street corridors." Rebase, formatting,
running a command, resolving conflicts, and closing a generic gate belong in
the work of this pull request, not its follow-up list. CI already runs `pnpm
check`, so the description does not need checkboxes for anything a command
proves.

If an AI agent wrote the changes or the description, co-author its commits
with a `Co-authored-by:` trailer. A reviewer reads agent-written code
differently and cannot do that without being told. Whoever opens the pull
request answers for what is in it either way.

## Community expectations

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Use [Support](SUPPORT.md) to choose the right public or organization contact.
Report exploitable vulnerabilities through the private paths in
[Security](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
