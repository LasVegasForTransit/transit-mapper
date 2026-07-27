# Architecture

## Context

TransitMapper is a browser-based editor for regional transit systems. A
system is a document: created, edited, and stored locally, and optionally
published as a read-only snapshot that anyone with the link can view or
copy.

Nobody signs in. There is no account, no collaboration, and no server-side
notion of "your systems".

```mermaid
flowchart LR
  author([Author])
  viewer([Viewer])
  embedder([Third-party page])

  subgraph client [Browser]
    editor[Editor]
    local[(Local library)]
  end

  subgraph edge [Edge]
    worker[Publishing service]
    db[(Snapshot store)]
  end

  osm[(OpenStreetMap)]
  gtfs[(Transit agency GTFS)]

  author --> editor
  editor <--> local
  editor -- publish --> worker
  editor -. import .-> osm
  editor -. import .-> gtfs
  worker <--> db
  viewer -- share link --> worker
  embedder -- iframe --> worker
```

External dependencies are read-only and optional. Losing OpenStreetMap or a
GTFS feed removes an import path; it does not affect editing.

## Components

### Domain core

The data model, geometry derivation, routing graph, renderer, and the
published-snapshot format. Pure: no DOM, no store, no framework.

Owns every rule about what a transit system is and how it is drawn. Owns no
storage, no transport, and no interaction state.

### Editor

The single-page application. Holds interaction state, renders the map, and
routes every document mutation through one store.

Owns no domain rules — it asks the core. Owns no server state.

### Publishing service

An edge worker with an attached database. Accepts a snapshot, serves it
back, and renders link previews and embeds.

Owns snapshot lifetime. Owns no domain rules: it stores what it is given and
validates it against the core's parser rather than its own.

## Flows

### Editing

Entirely local. The editor mutates the store, the store asks the core to
derive geometry and routes, and the result is written to the local library.
No network, no backend, no failure mode involving either.

### Publishing

1. The author requests a share.
2. The browser renders the link-preview image locally.
3. The editor sends the system and the image to the publishing service.
4. The service validates both, assigns an identifier, and stores a snapshot
   with an expiry.
5. The author receives a link.

The snapshot is a copy. Editing the system afterwards does not change what
was published.

### Viewing a share

1. A viewer opens the link.
2. The service reads the snapshot, and returns the application shell with
   the snapshot's metadata injected for link unfurling.
3. The application loads and renders the snapshot read-only.
4. Reading extends the snapshot's expiry, so a link in active use does not
   lapse.

### Embedding

A separate, minimal entry point renders the map alone — no editor, no
framework — because it loads inside a third party's page.

### Expiry

A scheduled sweep deletes snapshots past their expiry. Snapshots marked as
owned are exempt; nothing currently marks them.

## Decisions

### Local-first documents

**Chosen:** the browser is authoritative for work in progress. The backend
holds only published copies.

**Rejected:** server-authoritative documents with the editor as a client.

**Constraint:** the project must be usable by someone who never publishes
anything, and must not lose a user's work when the backend is unavailable or
retired. A nonprofit cannot promise indefinite hosting; it can promise that
losing the service does not lose the work.

### Snapshots, not synchronisation

**Chosen:** publishing copies the document. Nothing propagates back.

**Rejected:** live documents shared by link.

**Constraint:** shared links are public and unauthenticated. A live document
behind a public link is a document anyone can edit; making that safe
requires the accounts and permissions the project does not have.

### Rendering previews in the browser

**Chosen:** the client renders the link-preview image and uploads it.

**Rejected:** rendering it in the edge worker on demand.

**Constraint:** the edge runtime's per-request compute budget is an order of
magnitude below what rasterisation costs. The consequence is accepted
deliberately: preview bytes are attacker-supplied, so they are validated
structurally and served inert.

### Static assets bypass the worker

**Chosen:** only the API, share, and embed paths invoke the worker.

**Rejected:** routing every request through it.

**Constraint:** worker invocations are metered and assets are not. Routing
everything through it spends the invocation budget on files that never
needed logic, and exhausting it degrades the whole site rather than one
feature.

### One domain core across both runtimes

**Chosen:** the editor and the publishing service import the same core.

**Rejected:** a separate server-side model.

**Constraint:** the published preview and the editor's map must not diverge.
Two implementations of the same rules diverge on a timescale of months. The
cost is that the core must run in both runtimes, which the type system
cannot enforce and a lint rule does.

## Trust boundary

Everything reaching the publishing service is untrusted. It is the only
component that processes input from unauthenticated callers, and the only
one with tests exercising a real runtime and a real database rather than
mocks.

Three kinds of input cross it:

| Input                     | Constraint                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| A submitted system        | Size-capped, then parsed by the core's parser rather than trusted as-is           |
| A submitted preview image | Size-capped, structurally validated, served with a policy that prevents execution |
| A snapshot identifier     | Opaque; parameterised at the query layer                                          |

Stored text is unauthenticated and unsanitised at rest. It reaches markup
only through an escaping API, never string construction.

Publishing is rate-limited per client address, because it is the one path
that writes caller-supplied bytes to storage.

## Failure modes

| Failure                           | Effect                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| Publishing service unavailable    | Editing unaffected. Publishing and viewing shares fail.       |
| Snapshot store unavailable        | Editing unaffected. Existing links error.                     |
| Invocation budget exhausted       | Static assets still served. API, shares, and embeds rejected. |
| OpenStreetMap or GTFS unavailable | Import unavailable. Everything else unaffected.               |
| Browser storage full or cleared   | Unpublished work is lost. Published snapshots survive.        |

The pattern is deliberate: no backend failure can prevent someone editing,
and no client failure can affect anyone else.

## Invariants

| Invariant                                               | Property preserved                                      |
| ------------------------------------------------------- | ------------------------------------------------------- |
| The domain core references no DOM, store, or framework  | It runs in both runtimes and is testable without either |
| All document mutation passes through store actions      | Undo and derived-state upkeep cannot be bypassed        |
| Visual properties are separate from domain data         | Adding a transit mode does not modify the renderer      |
| One projector converts a system to renderable output    | Editor, embed, exports, and previews cannot diverge     |
| Stored values reach markup only through an escaping API | User-supplied text cannot become executable markup      |
| Snapshots are read through a versioned parser           | An old snapshot stays readable after the format changes |

## Unwired code

Identity, sessions, and snapshot ownership are implemented in the domain
core, tested, and imported by nothing.

There are no authentication routes, no user or session storage, and no owner
attribute on a snapshot.

Adjacent code anticipates it: the expiry sweep already exempts snapshots
marked as owned, and the schema reserves the field that would mark them.
These are preparatory. Every snapshot currently expires.
