# Dialog onboarding redesign

## Reader and purpose

This document is for the developer or contributor who will build, review, or
extend TransitMapper's pre-1.0 onboarding dialog. It defines what a first-time
reader must understand, the fictional proposal used to teach it, the four-slide
story, the boundary between passive onboarding and the interactive 1.0
experience, and the evidence required before the redesign is complete.

It assumes the reader has read
[Design principles](../../product/explanation/design-principles.md),
[The three views](../../product/explanation/views.md), and
[Route services over infrastructure](../../product/how-to/route-services.md).
Those documents define the product model this introduction must explain rather
than simplify away.

## The problem

The current introduction is visually polished but its fixture is a generic
cross: two colored lines, evenly spaced stops, one central transfer, and no
recognizable geography. Repeating that geometry in Network, Infrastructure,
and Diagram demonstrates projections of one model, but not what makes
TransitMapper useful. A first-time reader can leave believing it is a transit
diagram maker rather than a place where a rough service idea becomes a
physical and operational plan.

The introduction also says people can sketch a service and add infrastructure
later. That wording misrepresents the model. A service always runs on physical
corridors. Network drawing is the easy authoring gesture: it reuses compatible
infrastructure wherever possible and creates corridor geometry only for the
ground that is actually new. Infrastructure drawing remains infrastructure
only and never creates service.

The redesign must teach that infrastructure-first truth without making a
member of the public solve an engineering problem before drawing their first
line.

## Decisions

| Question           | Decision                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Release boundary   | Keep onboarding passive and dialog-based before 1.0. Task-based interactive onboarding belongs to the full 1.0 release.           |
| Audience           | Write equally for members of the public, transit advocates, and experienced transit planners. Explain the idea before the term.   |
| Example            | One fictional but realistic early proposal, not a mature regional network or a real agency's system.                              |
| Creation model     | Use reality first and create only what is missing. Infrastructure is the model; drawing a service is the shortcut.                |
| First service      | Demonstrate a bus line routing over streets already represented in the system.                                                    |
| New infrastructure | Demonstrate a rail service creating a basic alignment only where compatible track does not already exist.                         |
| Slides             | Four: draw a service, shape the physical network, define operations, and simulate the result.                                     |
| Renderer           | Use the production feature builder and simulation kernel against a fixed local fixture.                                           |
| Interaction        | Next, Back, close, and step selection only. Scene motion demonstrates actions but accepts no map input.                           |
| Final action       | “Draw your first service.” A genuine first run enters Network with the Bus line tool ready; replaying onboarding changes no tool. |

## Outcomes

After completing or watching the dialog, someone must be able to restate four
ideas in ordinary language:

1. Drawing a line on the map creates a transit service immediately.
2. Every service runs on physical infrastructure; TransitMapper reuses what
   exists and creates a basic corridor only where something is missing.
3. A service can have stops, branches, patterns, frequencies, and operating
   hours.
4. TransitMapper simulates vehicles following those paths and schedules; land
   use joins that simulation later.

The introduction succeeds when those ideas are visible without reading every
sentence. The visuals carry the action and consequence; the copy names them.

## Scope

This change covers:

- the onboarding slide data and dialog presentation;
- a replacement local fixture and its scene metadata;
- passive drawing, infrastructure, schedule, and simulation demonstrations;
- meaningful reduced-motion and preview-failure states;
- responsive treatment for desktop, short windows, and phones;
- the first-run Bus tool handoff;
- tests and maintainer documentation for the new scene boundary.

It does not cover:

- interactive practice, coach marks, checklists, or task completion tracking;
- changes to route drawing, conflation, adoption, infrastructure, or simulation
  semantics;
- new document fields for “existing,” “proposed,” or onboarding-only state;
- analytics or external telemetry;
- remote basemap, geocoding, or tile requests inside onboarding;
- changes to the location picker or the order in which first-run dialogs open;
- a separate design for land-use simulation.

## Product model and language

The governing sentence is:

> Use reality first; create only what is missing.

In Network, drawing a service over compatible streets or tracks routes or
rebinds that service onto those corridors. A stretch drawn over empty ground
keeps the default corridor the gesture created. The colored service appears in
either case, so a newcomer does not need to choose a workflow before expressing
the idea.

In Infrastructure, drawing produces bare roads, tracks, paths, or other
corridors. It never invents a service. The Infrastructure scene therefore says
“shape the physical network,” never “add the streets and tracks underneath.”

The introduction uses “branch” before “service pattern,” “every 10 minutes”
before “headway,” and “when it starts and ends” before “span of service.” The
production terms may appear beside those explanations, allowing an advocate or
planner to recognize the capability without requiring a newcomer to know the
vocabulary.

## The central Las Vegas proposal

The onboarding proposal is fixed, but its geography is not fictional. A
committed OpenStreetMap snapshot supplies recognizable central Las Vegas
streets and rail alignments without a runtime tile or Overpass request.

The fixture contains:

- actual Charleston Boulevard and Las Vegas Boulevard geometry;
- the existing north-south freight corridor through the Arts District and
  Symphony Park;
- the Medical District, Arts District, Downtown, Symphony Park, and Huntridge;
- an orange Charleston Crosstown bus service with Downtown and Huntridge
  patterns;
- a blue Downtown Connector light-rail service that reuses the freight corridor
  and adds one authored connection to Downtown;
- varied stop spacing, one shared downtown transfer, mode-appropriate corridors,
  default vehicle kinds, and schedules that produce comprehensible fleet
  requirements.

This is an early proposal someone could plausibly draw in one session. It has
two services and one operating complication, not a finished metropolitan
network. The fixture remains a valid `TransitSystem`; no special rendering
format substitutes for the domain model.

## Four capability screens

### 1. Draw a line. TransitMapper finds the path.

Copy:

> Sketch the trip people should be able to make. Bus service follows streets
> already on the map. When new infrastructure is needed, TransitMapper creates
> a basic alignment you can refine.

The scene begins on central Las Vegas streets. A passive CSS crosshair follows
the route as the orange Charleston Crosstown grows along Charleston Boulevard
and turns north on Las Vegas Boulevard. The growing line is the production
dashed route-preview source, not onboarding-only paint.

### 2. Shape the physical network.

Copy:

> Every service runs on roads or tracks. Import what already exists, create
> what is missing, and refine alignments, stations, grades, and crossings in
> Infrastructure.

The scene shows the same bounds in Infrastructure. Existing streets form the
substrate for Charleston Crosstown. The blue rail spine follows the existing
freight corridor and contains a short new connection into Downtown. The new
connection uses the production selected-way feature state rather than a custom
blue demonstration layer.

### 3. Decide how each service runs.

Copy:

> Add stops, branches, and different service patterns. Choose how often the
> service runs and when it starts and ends—TransitMapper shows what that
> operating plan requires.

The Network scene adds Charleston Crosstown's Huntridge pattern. Beside the map, a read-only
rendering of the production Service inspector's Schedule tab shows the selected
service, `Frequency · peak headway`, `Service hours · span of service`, and
resulting vehicle requirement. The
onboarding preview and editor share the same presentational components; the
preview must not imitate the inspector with onboarding-only controls.

### 4. Press play and watch the system operate.

Copy:

> Vehicles follow the routes, stops, and schedules you designed. Move through
> the day or change the speed to see the system operating.

Vehicles from the real simulation kernel move over both services. The shared
production simulation presentation shows play/pause, the full speed ladder in
its running `4×` state, and the advancing time. The normal
slide body also explains that a future release will let people explore how
transit and land use shape each other. This future capability does not receive
its own badge, note card, or simulated product control.

The final action is `Draw your first service`.

## Scene presentation

Every slide uses one generous preview. Desktop does not split the final scene
into three cards, and mobile never stacks several miniature maps.

The map remains local and deterministic. `buildFeatures` produces the same
service, way, station, facility, and vehicle features used by the editor. The
preview may add only the DOM presentation needed to render actual geography or
actual product UI:

- clipped OpenStreetMap LineStrings, real place labels, and compact attribution;
- a passive CSS crosshair for the drawing screen;
- a read-only instance of the production Service inspector's Schedule
  presentation for the operations screen;
- a read-only instance of the production simulation-control presentation for
  the simulation screen.

Onboarding does not add scene-name chips, mode badges, legends, hint pills,
schedule cards, or other controls that are absent from the editor. The
map itself communicates drawing, reused streets, new track, and simulation.
Shared inspector components describe the real fixture without creating records,
mutating the fixture, or entering serialization.

Scene motion begins when a slide becomes active. The drawing demonstration
plays once and settles on the complete service. Returning to the slide replays
it. The operations scene may loop because the simulated clock is continuous,
but it must not reset often enough to make vehicles jump visibly.

Under `prefers-reduced-motion: reduce`, drawing and transitions begin at their
settled final frames and vehicles remain at a representative simulated time.
The complete relationship must remain visible without motion.

## Component boundaries and data flow

`apps/web/src/ui/onboarding/slides.tsx` remains the content authority. Each
slide declares a scene identifier, title, body, and accessible visual
description. It does not contain fixture geometry or animation logic.

`apps/web/src/ui/onboarding/fixtureSystem.ts` owns the central Las Vegas
`TransitSystem`, stable IDs, service schedules, and
precomputed simulation inputs. Module initialization continues to reject an
invalid fixture or an impossible simulation plan.

`apps/web/scripts/generate-onboarding-las-vegas-context.ts` owns the fixed OSM
query, clipping, normalization, and deterministic ordering. Its committed JSON
output is adapted by `las-vegas-context.ts`, which exposes typed LineStrings,
real-place labels, bounds, and attribution without mutating the snapshot.

`apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx` owns MapLibre setup,
production feature projection, framing, markers, and scene timing. Pure helpers
that turn elapsed time into a drawing extent, cursor position, simulated time,
or settled state stay outside React effects so ordinary Vitest can prove them.

Shared kebab-case components under `apps/web/src/ui/inspector/` own the Schedule
fields and service-load presentation used by both the live Service inspector and
the onboarding preview. A small read-only onboarding adapter supplies fixture
values and positions that real inspector presentation beside the operations
map. `onboarding-scene-overlay.tsx` contains that adapter, the shared simulation
presentation, and plain failure copy; it does not invent a separate onboarding
control language or read editor state.

`apps/web/src/ui/onboarding/OnboardingDialog.tsx` remains the carousel
orchestrator. It chooses the current slide, supplies the scene to the preview,
and owns navigation semantics. It does not gain map or simulation logic.

The data flow is one-way:

1. Slide selection chooses a scene identifier.
2. The preview reads the immutable fixture and scene metadata.
3. Pure timing helpers derive the current presentation frame.
4. Map sources and, for operations, shared production inspector components
   render that frame.
5. No result returns to the editor or saved system.

## First-run handoff and replay

The existing location-picker-to-onboarding sequence stays unchanged. A genuine
new system arms the Bus mode before the dialog opens, so imported streets are
the easiest first path and a blank canvas still has the create-what-is-missing
fallback. Completing the dialog closes it and leaves the Bus line tool ready.

Replaying the introduction from an existing system changes no tool, view,
selection, camera, or document state. Completion continues to mark onboarding
seen only from the final action; closing early remains incomplete and shows the
introduction again on a later visit.

## Responsive behavior

Desktop retains a large centered dialog with one map occupying most of the
body. On the operations slide, the read-only production Schedule presentation
sits beside the map and never covers the route branch or downtown transfer.

At phone and short-window breakpoints, the dialog remains a bottom sheet. The
body scrolls independently while navigation stays reachable. Place labels
reduce to the smallest set needed for the story. The production Schedule
presentation moves below the map rather than floating over it. Preview framing
is recomputed after every resize; a desktop fit is never reused on a phone.

The stepper gains visible `n of 4` context in addition to its keyboard and
screen-reader labels. The active state may not depend on color alone.

## Accessibility and failure behavior

Each scene has a concise accessible description naming the relationship the
visual demonstrates. The internal non-interactive MapLibre canvas is hidden
from the accessibility tree when the containing scene already exposes that
description; screen readers must not encounter an unexplained generic `Map`
region.

Motion follows the reduced-motion rule above. Decorative pointer and vehicle
markers are hidden from assistive technology because the scene description and
visible Schedule presentation carry their meaning.

Preview initialization or rendering failure never blocks navigation or takes
away the copy. The visual area falls back to the accessible scene description
as plain readable text. It does not expose exception text, imitate an editor
surface, or ask the reader to retry a local deterministic preview.

## Verification

Automated verification covers:

- the central Las Vegas fixture passes domain validation;
- both services resolve over compatible infrastructure;
- Charleston Crosstown has two named patterns and the shared Downtown transfer belongs
  to the intended services;
- the schedules produce stable, nonzero simulation plans and expected fleet
  values;
- every slide declares one of the four required outcome categories and a
  nonempty accessible visual description;
- onboarding contains no beta pill, scene-name chip, hint pill, legend, or
  onboarding-only imitation of an editor control;
- the operations scene renders the same Schedule fields and service-load
  presentation used by the live Service inspector;
- pure scene timing reaches the correct partial and settled drawing states;
- reduced motion selects settled frames and suppresses continuous vehicle
  animation;
- the dialog retains forward, back, direct-step, keyboard, dismissal, replay,
  and final-completion behavior;
- completing a genuine first run leaves Bus armed while replaying the dialog
  preserves the existing tool;
- a failed preview leaves readable content and working navigation.

Manual browser acceptance captures and reviews every slide at a normal desktop
viewport and at 390 by 844 pixels. It confirms that the system reads as a
plausible early proposal, route geometry follows visible geography, the real
Schedule presentation does not obscure the map, no invented product UI appears,
all actions remain reachable, and reduced motion communicates the same four
outcomes.

`pnpm check` is the completion gate.

## Documentation

If implementation changes the onboarding file boundary described in
[Project structure](../../development/reference/project-structure.md), that
reference changes in the same commit. User-facing documentation must keep the
same two-workflow truth: infrastructure-first and sketch-first are both valid,
and Network drawing reuses compatible reality before retaining new corridor
geometry.

## Completion criteria

The redesign is complete when:

- the generic cross fixture is gone;
- the four required ideas are visible and stated in the approved sequence;
- no copy describes infrastructure as an optional layer added after a service;
- the bus example follows existing streets and the rail example visibly uses
  both existing and newly created infrastructure;
- every product-looking element matches a shared production component; no
  onboarding-only chips, legends, clocks, or schedule controls remain;
- desktop and mobile show one legible system rather than miniature comparison
  cards;
- motion, reduced motion, preview failure, first-run completion, and replay all
  have verified behavior;
- documentation and `pnpm check` pass.
