# NERC org map — manual acceptance checklists

Quick passes to run by hand after sizing/label tuning. Each line names what to
look for and where in `nerc-org-map.ts` the behavior lives.

## Desktop overview (wide viewport, `compact === false`)

- [ ] **Bubbles are large at the overview.** Top orgs read clearly without
      zooming. — `visualRadius` (`maxPx = MAX_RADIUS`, `overviewScale = 0.62`).
- [ ] **Important orgs are prominent.** ISO/RTOs, federal, regulated and
      reliability orgs are the biggest and place first. — `visualPriority` +
      `visualPrioritySort` drive both size and `computePlacements` ordering.
- [ ] **No major overlap.** Placement guarantees zero-overlap; dense areas hide
      overflow rather than stacking. — `computePlacements` `fits()` check.
- [ ] **Labels are readable.** The heaviest orgs carry inside or floating labels
      at the overview; small orgs stay unlabeled until there's room. —
      `shouldTryLabel`, `labelLimit`, inside/float logic in `redraw`.
- [ ] **Centers stay on land.** No bubble center drifts into ocean. —
      `onLand` gate in `computePlacements`.
- [ ] **Panning is stable.** Pan never re-solves placement; only zoom buckets do.
      — bucket cache in `computePlacements`, group-transform pan in `redraw`.

## Mobile viewport (`compact === true`, element width < 640)

- [ ] **Overview feel preserved.** Bubbles already large when zoomed out, the
      iOS look the desktop now matches. — `visualRadius` `overviewScale = 0.52`.
- [ ] **Zoom growth works.** Each zoom step yields visibly larger circles all the
      way in. — `visualRadius` `zoomT` (compact ramp) + `zoomGrowthPx` + deep
      boost.
- [ ] **Labels grow with zoom.** Even small-org names get bigger once you zoom in
      close; long names fall back to the short token. — `labelFontPx`
      `midHighBoost`, inside-chord clamp.
- [ ] **Taps are accurate.** Tap targets track the bubble plus a floor sized for
      touch; the deepest-inside bubble wins in dense areas. — `hitTargetRadius`
      compact floors, `nearestOrgAtPointer` normalized distance.
- [ ] **No ocean drift / no overlap.** Same algorithm as desktop with tighter
      limits. — `computePlacements` (`onLand`, `fits`, compact `placementRadius`).
- [ ] **Selecting a bubble doesn't jump the view.** — `keepFocusedOrgInView`
      only acts during an active zoom gesture, never on click.
