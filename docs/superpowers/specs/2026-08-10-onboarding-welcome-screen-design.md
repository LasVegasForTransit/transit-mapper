# Onboarding welcome screen

## Problem

TransitMapper's onboarding currently begins with “Draw a line.” That is a useful
first lesson, but it assumes a first-time visitor already understands what the
product is and why they might use it. The dialog explains four capabilities
without first establishing the product itself.

## Decision

Add a purpose-only welcome screen before the four existing capability screens.
The resulting five-screen sequence is:

1. Explain what TransitMapper is and invite the person to begin.
2. Draw a transit service on the map.
3. Shape the physical network.
4. Configure service patterns and schedules.
5. Simulate the designed system.

The welcome screen uses this exact copy:

> **Welcome to TransitMapper**
>
> TransitMapper is a tool for imagining, designing, and testing public transit
> systems on a real map.
>
> **Start with a place and design the transit system you want to see there.**

The primary action says **See how it works**. The existing final action remains
**Draw your first service**.

## Visual treatment

The welcome screen shows the completed central Las Vegas proposal as a calm, static
network overview. It uses the same valid onboarding fixture and production map
projection as the later screens. A committed, attributed OpenStreetMap snapshot
supplies the real street and rail context without a runtime request. The
overview includes the coherent routes, stations, geography, and place labels
that a person will encounter in the rest of the sequence.

The overview does not animate vehicles, demonstrate a tool, enumerate features,
or add onboarding-only chips, legends, statistics, or controls. Its purpose is
to make the product definition concrete without beginning the tutorial early.

## Interaction and accessibility

- The welcome screen is step 1 of 5; the existing screens become steps 2–5.
- **See how it works** advances to “Draw a line. TransitMapper finds the path.”
- Back, indicator-tab, arrow-key, Home, and End navigation continue to work over
  all five screens.
- The completed-system visual has a concise accessible description that names it
  as a central Las Vegas transit proposal.
- Closing the dialog still does not complete onboarding. Only the final action
  marks onboarding complete and arms the first bus service on a genuine first
  run.

## Boundaries

This change adds no interactive tutorial, remote map request, editor mutation,
new document field, or new product control. It does not revise the approved copy
or behavior of the four capability screens.

## Verification

Automated coverage must prove that the purpose screen is first, the flow contains
five screens, its exact copy and action are present, keyboard navigation reaches
the new final index, and completion still occurs only from the last action.

Visual review must capture all five screens at desktop and phone sizes. The
welcome image must read as a completed transit system rather than a generic
diagram, and every footer action must remain reachable.
