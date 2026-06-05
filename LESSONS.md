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
- **Progressive disclosure, not faint‑everything.** Dots below their reveal window
  are not drawn at all (the `RENDER_EPS` gate in `redraw` *and* the declutter
  solver). Reveal zoom is **continuous** in an importance score with a per‑id jitter
  so near‑identical dots (the ~800 generators) trickle in instead of a whole tier
  flooding at one zoom — a flood crashes dot size and re‑spikes overlap. See
  `orgScore`/`orgMinZoom` and the `nerc-map-disclosure-model` memory.
- **Do not reserve margin around visible bubbles.** The user wants bubbles to pack
  edge-to-edge if needed: no bubble padding and no solver gap. The non-overlap rule
  is about actual drawn bubble bodies, not decorative whitespace. Hidden/future
  bubbles should not push visible ones around; at low zoom the declutter solver is
  capped to plausible visible candidates, and final label placement remains the
  authority on what is actually drawn.
- **Labels are an ordered decision tree, evaluated most‑important first:**
  1. **INSIDE** — if the short token fits in the bubble at a legible size, draw it
     there. Inside labels are collision‑free and run *before* dedupe/thinning, so a
     bubble big enough for its name always shows it.
  2. **FLOAT** — otherwise place beside/below (above is last resort; the user
     strongly dislikes labels floating above their dot). A floating label must
     **physically clear every other protected bubble** (non‑overlap is now the
     primary suppression rule), so a small org's label never lands on a big org's
     bubble.
  3. **THIN/DEDUPE** — identical on‑screen tokens (AEP, Evergy, MEAN…) collapse to
     the single highest‑priority instance.
- **Isolation boost:** lonely dots grow and always try for a label, which is what
  fills the empty Mountain West / Plains. **Generation‑only dots stay smallest** so
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
2 viewports. The reusable tool for this:

- Load with **`?audit=1`** to expose `window.__nercAudit`
  (`setZoom`/`setZoomAt`/`audit()`), which drives the *real* renderer and reads out
  per‑bubble water coverage (reusing the actual land mask), displacement, overlaps,
  label inside/float, and high‑priority label coverage. Ships inert.
- **`node scripts/ux-audit.mjs`** is a headless‑Chrome (CDP) driver that sweeps
  ~20 zooms on desktop (1440×900) + iOS (390×844), dumping stats + screenshots to
  `/tmp/nerc-audit/`. Re‑run it after any sizing/disclosure/label change; read the
  PNGs to confirm the numbers match what you'd actually see. This caught that
  "severe overlap" counts can both under‑ and over‑state the visible problem.

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
  score "high" — it does not by itself produce a clean overview count. That's why
  disclosure layers a continuous reveal curve + per‑id jitter on top of it.

## 6. Where to look before changing things

| You're about to… | Read first |
| --- | --- |
| change what's visible at a zoom | `orgScore`/`orgMinZoom`/`dotStrength` + `RENDER_EPS`; memory `nerc-map-disclosure-model` |
| change label placement | the INSIDE→FLOAT→THIN loop in `redraw`; memory `nerc-name-research` |
| change dot size | `visualRadius`/`renderedRadius`/`isolationBoost`/`hitTargetRadius` (all `compact`‑aware) |
| move dots / fix offshore drift | `relaxDeclutter` + `buildLandMask`/`clampToLand` (base‑space!) |
| touch data | `enrich.mjs`/`build-orgs.mjs`; never the renderer; respect seed/supplemental rules in AGENTS.md |
| verify a visual change | `?audit=1` + `scripts/ux-audit.mjs`, then `npm run check` |
