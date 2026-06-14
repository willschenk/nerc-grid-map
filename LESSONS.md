# Lessons learned — context for future AI work on this map

This file distills hard‑won lessons from the project's history so the next agent
doesn't re‑learn them. It is **not** a changelog (use `git log` — the commit
bodies are detailed and worth reading). Read this alongside [AGENTS.md](AGENTS.md)
(structure/commands) and the memory notes it references.

The whole project is essentially one interactive D3 map of ~2,200 NERC entities.
Almost every commit is either **data** (geocodes, names, supplemental orgs) or
**display** (the renderer in `src/lib/nerc/map/nerc-org-map.ts`). Know which one
you are doing before you touch anything.

---

## 0. The cardinal rule: display vs. data

**The user actively edits the data (coordinates, display names, supplemental orgs)
in parallel, mostly via Cursor. When doing a *display* task, NEVER change data —
only the renderer/CSS.** A large fraction of commits explicitly say "Display‑only;
no data changes." Violating this clobbers the user's in‑flight work.

- Data lives in `src/data/nerc/*` (`geocoded-orgs.json`, `org-names.json`,
  `supplemental-orgs.json`, …) and is baked to `public/nerc/orgs.json` at build.
- `public/nerc/orgs.json` is generated. Do **not** hand‑edit it, and **revert the
  one‑line `generated_at` timestamp churn** a rebuild produces if it's the only
  diff — don't commit no‑op data changes.
- The renderer must never recompute weight/color/flags; those are precomputed in
  `enrich.mjs`. Change the math there, not in the client.
- Seeds (`NCR-SEED-*`) auto‑retire when their authoritative twin is geocoded
  (`seed-twins.json`). Never hand‑delete a seed. Supplemental build is merge‑only
  so hand/Cursor edits are never clobbered.

## 1. Shared working tree — commit hygiene

The user's Cursor agent and the Claude sessions **share one working tree**, so the
tree often contains someone else's in‑progress edits. Because of this:

- **Run `npm run check` (astro + TS, expect 0 errors) before every commit.** This
  is stated over and over; it's the contract that keeps shared WIP green.
- When you commit, **stage only the files you changed** (explicit paths), not
  `git add -A` — you'll otherwise sweep up the user's uncommitted data edits.
- It's normal and good to commit someone else's WIP as a "green checkpoint" so a
  deploy corresponds to a real commit — but say so in the message.
- If on `main`, branch → commit → fast‑forward merge → push (keeps history linear,
  which this repo prefers). Deploy is `npm run deploy` = build + force‑push `dist/`
  to `gh-pages` from a throwaway temp dir (never touches the main tree).

## 2. The renderer is the whole game — and it's subtle

> **Current disclosure model (2026-06-13), supersedes the bullets below that
> describe `visibleCap`/floating-label/fallbackTiny iterations.** A bubble shows
> **iff its short name fits legibly inside it** (`labelFitsInside()` — the one gate,
> shared by `computePlacements` and `redraw`). Consequences the user asked for and
> that must be preserved: every visible bubble always carries a readable inside
> label; zoomed-out shows fewer/larger/higher-rank bubbles; lower-rank fill in as
> you zoom into an area; bubbles pack non-overlapping; no-slot → held back (never an
> unlabeled dot). Because non-overlapping bubbles + inside-only labels can't
> collide, the inside label is drawn unconditionally (no cap/dedup/collision). Tune
> coverage via `visualRadius` overviewScale; small-org freedom via
> `orgPlacementRadius` smallMult. See memory `nerc-map-disclosure-model`.

Most of the iteration is the map. Principles that have repeatedly proven right:

- **Size labels (and reason about "too small") in real CSS pixels**, via
  `unitPerPx` (= `W / elementWidth`). The viewBox is sized to the element's aspect
  ratio (so tall phones don't letterbox), which means viewBox units ≠ pixels and
  differ massively between desktop (`unitPerPx≈0.67`) and a phone (`≈2.46`).
- **Dots ride the zoom‑transformed group.** Pan/zoom is one group `transform`
  (GPU‑composited); do not reposition 2,200 dots in JS per frame. Declutter offsets
  (`_dx/_dy`) are screen‑space nudges **divided by k** at render so the true
  projected `_x/_y` stays authoritative. Redraw is rAF‑throttled.
- **Three coordinate spaces, and mixing them up gives wrong answers:** (a) *base
  viewBox* — projection output and the land mask live here; (b) *screen* — after
  the zoom transform (`_sx/_sy`); (c) *solver* — base × `bucket` inside
  `relaxDeclutter`. The land mask `onLand(x,y)` expects **base** coords; a dot's
  on‑screen radius is `renderedRadius/k` in base space. (I got this wrong first in
  the audit; verify which space a number is in before comparing.)
- **Coastal dots may sit slightly offshore — that is acceptable and honest.** The
  land mask clamps declutter so dots never drift *far* to sea (the "≤~80% into
  water" rule), but Long Island / Block Island / Cape Cod utilities are genuinely
  in the water. Don't "fix" real coastal geography onto land.
- **Disclosure is zoom‑only, rank‑based — and that is what makes panning calm.**
  Every org gets a global importance rank (`_rank`, from `orgScore`, computed once).
  A dot shows iff `rank < visibleCap(zoom)` (`dotStrength` ramps it with a soft
  edge). `visibleCap` grows ~quadratically with zoom, so zooming into anywhere
  reveals that area's locals. Because it depends only on rank + zoom, **the visible
  set never changes as you pan.** The user's bar: *panning must cause no motion;
  only zooming adds/removes/resizes bubbles.* The whole earlier model (continuous
  `orgMinZoom` reveal, compact anchors, a top‑up pass, `declutterItemLimit`) was
  deleted for this. Tune density with `visibleCap`'s `overview` constant.
- **Anything that reads the on‑screen/neighbour set makes bubbles move on pan —
  don't.** The big offender was the isolation system (`computeIsolation`/`_iso`/
  `isolationBoost`): it resized dots from their live neighbours, so they grew/shrank
  as you panned. Gone. **Radius = `visualRadius` = pure `weight × zoom`**, nothing
  else. Same reasoning killed floating labels (greedy, viewport‑ordered) — see the
  label note below.
- **Keep bubbles near their true spot.** `maxDeclutterOffset` is deliberately small
  (a "little" movement to ease overlap, never far). Dense regions just overlap —
  *bubbles sit next to each other*, the user's explicit preference — rather than
  drifting offshore or across the map. The land‑mask clamp still bounds water drift.
- **Render every disclosed bubble; labels are a separate layer on a subset.** A
  past refactor set `_vis = hasLabel`, which collapsed the map to ~140 dots (only
  the labelled ones drew). That is the opposite of "show as much as you can." Keep
  bubble visibility (the rank gate) independent of whether a label landed.
- **Do not reserve margin around visible bubbles.** The user wants bubbles to pack
  edge-to-edge if needed: no bubble padding and no solver gap. The non-overlap rule
  is about actual drawn bubble bodies, not decorative whitespace. Hidden/future
  bubbles should not push visible ones around; at low zoom the declutter solver is
  capped to plausible visible candidates, and final label placement remains the
  authority on what is actually drawn.
- **Labels are inside‑bubble only (for pan‑stability).** A label sits centred
  inside its bubble iff the short token fits at a legible size; otherwise the dot
  waits until you zoom in and the bubble grows. Inside labels ride their bubble (no
  collision, no greedy placement), so they never move or flicker as you pan — unlike
  the old floating labels, which were placed greedily over the *on‑screen* set and
  so reshuffled on every pan. Identical tokens dedupe at the broad overview. Only
  hover/selection floats a name (below the dot) when it can't fit inside.
- **Generation‑only dots stay smallest** so
  the sea of plants doesn't balloon.

## 3. iOS/mobile is a first‑class, separate target

The user reviews on a real iPhone and will call out when it "feels static" or dots
are "too small / stranded / clustered." iOS is not desktop‑scaled — it needs its
own tuning at nearly every knob:

- Because CSS‑px dots are ~2.4× bigger in the *same* US viewBox footprint, the
  compact overview crowds fast. It needs a **stricter "major" cutoff** (the
  `compact ? 82 : 55` anchor) so the overview shows only majors and fills in on
  zoom — desktop keeps its fuller overview. **When desktop already looks good,
  don't touch it to fix iOS; gate the change on `compact`.**
- Spreading an over‑full container does **not** reduce overlap — it just pushes
  dots to the cap. The only real levers for crowding are *fewer* or *smaller* dots.
- At the all-the-way-out iOS overview, excessive declutter displacement reads as
  organizations floating away from their geography. Keep compact low-zoom movement
  tightly capped and let bubbles hide until they can fit; do not use large margins
  or hidden candidates to force more spacing.
- Mobile chrome: floating bottom‑right tour FAB (≥44px, safe‑area aware), top‑safe
  bands so labels clear the floating topbar, pressed (not hover) feedback.
- iOS performance is real: bound the animated/labeled set, transform‑only pulses
  (never re‑stroke in an animation), cap label candidates per frame during the
  tour, skip per‑frame hit‑radius rewrites when zoom is unchanged.

## 4. Tune from measurement, not vibes

Spatial/visual tuning by eyeball is slow and unreliable across 20 zoom levels ×
2 viewports. Measure instead of guessing.

- **The in‑page audit harness (`?audit=1` → `window.__nercAudit`) and the headless
  `scripts/ux-audit.mjs` driver were removed in `00d97b1`** ("remove dev tooling"),
  along with the dev zoom‑lock and the `?debug=1` render‑stat counters. If you need
  measured tuning again, re‑introduce a harness that drives the *real* renderer and
  reads per‑bubble water coverage (reuse the actual land mask), displacement,
  overlaps, label inside/float, and high‑priority label coverage — and keep it inert
  in production. Don't tune sizing/disclosure/labels by eyeball alone.
- For load/render *performance* (not spatial tuning), measure payload bytes
  directly (`ls -l public/nerc/orgs-render.json`) and reason from the field‑cost
  breakdown — the render payload should carry ONLY fields the renderer reads
  (`RENDER_ORG_FIELDS` in `build-orgs.mjs`); everything panel‑only is lazy in
  `org-details.json`. `npm run nerc:payload-check` enforces the split is lossless.

## 5. Map gotchas worth knowing up front

- `geoAlbersUsa` is **50‑states only.** Territories (PR/VI/GU/MP/AS) can't project
  into it — they're laid out as separate labelled insets (`geoMercator` + a real
  `fitExtent` for true relative geography). Canada is a separate conic locked to
  the composite's scale/translate so it lines up north of the border.
- The bubble‑placement acceptance bar the user holds: major bubbles **fill the US
  landmass** at low zoom (generalized/displaced is OK); **no dots stranded
  mid‑ocean**; **high‑priority appears before low‑priority**; **more bubbles +
  more geographic accuracy as you zoom in**; **labels ideally inside bubbles**;
  hide what can't fit cleanly until there's room.
- `orgPriority` is a generous additive score (type/role bonuses), so *many* dots
  score "high." It feeds `orgScore` (+ weight + per‑id jitter), which is ranked once
  into `_rank`; disclosure is then just `rank < visibleCap(zoom)`.

## 6. Where to look before changing things

| You're about to… | Read first |
| --- | --- |
| change what's visible / density at a zoom | `visibleCap` + `_rank`/`orgScore`/`dotStrength`; memory `nerc-map-disclosure-model` |
| change label placement | the inside‑bubble label loop in `redraw`; memory `nerc-name-research` |
| change dot size | `visualRadius`/`renderedRadius`/`hitTargetRadius` (pure weight×zoom, `compact`‑aware) |
| make panning calm | keep sizing/labels/positions off the on‑screen set; only `transform.k` may drive them |
| move dots / fix offshore drift | `relaxDeclutter` + `buildLandMask`/`clampToLand` (base‑space!) |
| touch data | `enrich.mjs`/`build-orgs.mjs`; never the renderer; respect seed/supplemental rules in AGENTS.md |
| verify a visual change | side‑by‑side vs the frozen baseline at matched zooms (desktop + iOS), then `npm run check` (the old `?audit`/`ux-audit.mjs` harness is gone — see §4) |
| fix a bad map label | read [docs/bugs/map-label-filler-bug.md](docs/bugs/map-label-filler-bug.md) first; prefer manual `KNOWN_ACRONYMS` / `org-names.json` over bulk scripts |

## 7. Map labels — production baseline and the filler bug

**Production map behavior is frozen at gh-pages `c0ca47b`** (2026-06-10 deploy). Bubble placement, disclosure, declutter, and dot density on that deploy are correct. Do not ship label or renderer changes without verifying against that baseline (side‑by‑side at low zoom on desktop and iOS).

**One known text bug remains:** `tightenMapLabel()` in `display-names.mjs` can emit meaningless single‑word labels — connectives and generic nouns — when it "prefers the last word" after stripping industry descriptors. Examples: Connecticut Light and Power → `and`, Hydro One → `One`, Muscatine Power & Water → `Water`. Full write‑up, root cause, and every fix attempt tried so far: [docs/bugs/map-label-filler-bug.md](docs/bugs/map-label-filler-bug.md).

**What not to do (learned the hard way):**

- **No automated 100‑label batch scripts** without a user‑supplied manual target list. Bulk patches to `KNOWN_ACRONYMS`, `NAME_RULES`, and `org-names.json` sometimes improved labels but often made others worse.
- **Do not mix label fixes with data/pipeline WIP.** Running `npm run dev` rebuilds org data via `predev` → `build-orgs.mjs`. Uncommitted changes to `geocoded-orgs.json`, `build-orgs.mjs`, or alternate‑location scripts change dot counts and low‑zoom density — easy to misattribute to a label‑only diff.
- **Do not ship algorithmic filler guards** until manually reviewed against `c0ca47b`. A local `isFillerLabel()` / `recoverLabel()` pass fixed the specific examples but the user rejected it when local did not feel identical to production.
- **Label work spans build and runtime:** `name_shortest` is baked in `enrich.mjs`; `tinyName()` / `NAME_RULES` in `nerc-org-map.ts` can override at runtime. Fix the layer that actually produces the bad token.
- **Hard cap is 8 chars** (`MAP_LABEL_MAX`). Curated names longer than 8 get truncated by `tightenMapLabel()` — check length when adding `KNOWN` entries.
