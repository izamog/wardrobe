# Design — Wardrobe

A locked design system for this app, seeded from a `hallmark study` DNA extraction
of uk.burberry.com/l/womens-clothing/ (image mode — see the diagnosis in
conversation history for the source read), then amended repeatedly on direct
user feedback (see § Amendments). Every screen redesign reads this file
first; amend it here rather than picking a new look per screen.

## Genre
editorial (luxury-retail register: restraint, generous whitespace, near-zero
chroma, one deliberate accent)

## Provenance
Studied DNA, not a catalog theme: paper/ink/accent are estimated from the
source's colour bands (image mode — no exact values available), then
originally shifted off the source's own accent (cool blue) onto oxblood, a
classic luxury-fashion anchor, per the "theme drift is allowed" rule — the DNA
that travelled is the *restraint* (near-zero chroma, tiny accent footprint,
borderless imagery), not the specific hue. Round 11 (see § Amendments)
dropped the oxblood accent itself in favour of a fully neutral palette — a
later, explicit requirement that the app's own colour never compete with a
photographed garment's, superseding the "classic luxury-fashion anchor"
choice this section originally described. The restraint that travelled from
the source DNA is what remains; the specific accent hue does not.

## Amendments
Ten rounds of user feedback amended the original system rather than
replacing it — all are folded into the tokens/type below, not layered on top:

1. **Box-in-box.** No image gets a bordered, rounded, white-backed "card"
   around it purely for decoration, and nothing that already draws its own
   edge (`OutfitCollage`) gets wrapped in a second bordered container. See
   § The box-in-box rule.
2. **Warmer-than-wanted background, feminine display face, undersized brand
   text, inconsistent chrome.** The original `paper` (`#FAF8F5`, ivory) read
   too warm; the original display face (Cormorant Garamond) read too
   feminine/delicate; Closet's brand-name text (12px) was flagged as
   possibly sub-AA; and the header/tab-bar/bottom-bar each had their own
   background and border, so top and bottom chrome didn't read as one
   surface. All four are fixed in the current tokens below.
3. **Item grid rows, round 1 (superseded by round 2 below).** A photo sitting
   on a flat `paper` fill read too flat; the first attempt gave each grid
   *tile* its own photo band + white label band + outer padding. That
   reintroduced box-in-box (a grid of individually-boxed cards) and used a
   700-weight sans that read too heavy.
4. **Item grid rows, round 2 (current).** Corrected per direct feedback: the
   white band belongs to the *row*, not the item — a row of flush,
   edge-to-edge photos (zero gap, no outer padding) with one continuous
   white band spanning the full row width underneath, holding each photo's
   brand name in its own column. Font dropped from Archivo 700 Bold to
   Public Sans 300 Light — "classy," not heavy. Applies to Closet, Log
   Outfit's item picker, and the Matches browser (all three grids, not
   Closet alone). See § Item grid rows. There is no separate "old" and
   "new" system to reconcile anywhere in this file — it already reflects
   the fully amended one.
5. **Full per-role type system, and the app-launch splash removed.** A
   detailed role → weight mapping replaced the two-family (serif +
   brand-sans) system: Playfair Display for screen titles, four Public Sans
   weights (300/400/500/600) for everything else, each weight tied to a
   named role (labels, values, buttons, big numbers, emphasis) rather than
   picked per screen. Source Serif 4 and Archivo were both dropped — nothing
   uses them anymore, so their packages were uninstalled. Separately, the
   app-launch "Opening your wardrobe…" splash was removed: the navigator now
   renders immediately and each screen shows its own loading state instead.
   See § Typography and § Startup.
6. **WCAG 2.2 pass: touch targets, edge spacing, verdict colour.** A full
   audit found several secondary buttons sized well under the 44pt/48dp
   guidance (`ItemDetailsScreen`'s photo action buttons at ~36px with
   12px labels, `ArchiveScreen`'s Restore button, `ClosetScreen`'s bulk
   Delete button, `Form.tsx`'s date-picker Done/Clear buttons) — all bumped
   to a ≥44px effective height, several also gaining `hitSlop`. Fixed-bottom
   action bars (`BottomBar`) and the two screens whose primary buttons sat
   in a bare `p-4` container had their edge padding widened from 16px to
   20px (`px-4`→`px-5`) so buttons read with real margin from the screen
   edge rather than flush against it. The calendar day-of-month number
   (`CalendarScreen.tsx`) was `text-[10px]`, below any role's floor
   elsewhere in the app — raised to `text-xs` (12px). Item photos also lost
   the flatlay drop-shadow experiment from the same round: tried, then
   explicitly reverted at the user's request — no shadow on garment photos
   anywhere. Separately, `match`/`dismatch` verdict badges (`ItemGrid.tsx`'s
   `BadgeCircle`) stopped reusing `accent` (oxblood) for "match" — that
   token already means "primary action" everywhere else in the app, so a
   correct verdict read as just another neutral button next to the clearly
   red "dismatch" badge. A dedicated `success` token (`#2E6E49`, muted
   green, same lightness/chroma recipe as `accent`) now carries "match"
   only. See § Theme and § Touch targets.
7. **Closet header crowding, Calendar's blank-until-scroll, and the outfit
   collage's undersized Top/Sweater/long-bottom slots.** Three unrelated
   fixes from the same feedback round:
   - `ClosetScreen`'s header had three controls (camera, archive, Select)
     packed into `headerRight`, leaving Select hard against the screen
     edge. Camera and archive moved to `headerLeft` — a tab root screen has
     no back button to share it with — leaving Select alone on the right.
   - `CalendarScreen` rendered fully blank on first open, then jumped to a
     week roughly a year in the past on the first manual scroll. Root
     cause: `useWindowDimensions()` can report a stale/zero width for the
     first render or two, and this screen can now be the very first thing
     to mount (see round 5's splash removal) — before the native bridge
     has delivered a real measurement. `getItemLayout`'s row height,
     computed from that bad width, made `FlatList`'s one-shot
     `initialScrollIndex` jump lands near array index 0 (the oldest week)
     instead of today's. Fixed by not mounting the `FlatList` at all until
     `windowWidth > 0`, showing the existing loading spinner in the
     meantime. See `CalendarScreen`'s own comment above `widthReady`.
   - `utils/outfitCollageLayout.ts`'s Top, Sweater/Cardigan and every long
     bottom (long/mid/capri/cropped pants, midi/maxi/knee-length skirts,
     leggings) were sized at 1.25 boxes (25% of canvas width) — visibly
     smaller than Shoes, Coat and Bag at 2-2.5 boxes, despite covering a
     comparable or larger share of the body in reality. Widened to 2 boxes
     (matching Shoes/Bag exactly), using the same `widthOnlyBox` mechanism
     those three already used — this was a stated-width problem, not a
     mechanism problem; Top/Sweater/long-bottom were already on the
     width-only path, just with too small a number. See § Item collage
     sizing.
8. **Calendar rebuilt as a regular monthly view; Belt/Tights widened;
   `LogOutfitScreen`'s preview canvas enlarged.** Three more fixes from
   direct feedback:
   - The continuous-weeks Calendar (round 6's fix target) is gone entirely,
     replaced by a standard monthly grid: one page per month, exactly 6
     Monday-start rows (leading/trailing days from the adjacent month shown
     dimmed and inert, never a real cell), flipped between horizontally —
     opens on the month containing today. `utils/calendarGrid.ts`'s
     `weeksAround`/`calendarRowHeight` (continuous-week-scrolling-only) are
     gone with it; `monthsAround`/`monthGrid`/`monthLabelForKey` replace
     them. The same "don't mount the FlatList until `useWindowDimensions`
     reports a real width" guard from round 6 carries over unchanged — now
     protecting horizontal page width instead of vertical row height, same
     underlying bug.
   - Belt was still "too small" at 1 box even after round 7's other
     widenings — bumped to 1.5 boxes (not the full 2 boxes shared by
     tops/bottoms/bag/shoes, since a belt genuinely is a thinner accessory
     in reality). Tights, per explicit instruction, now take a full box
     (1 → previously 0.75).
   - `LogOutfitScreen`'s `SelectionPreview` collage sat in a fixed `w-40`
     (160px) container — every item inside it was already the correct
     *fraction* of that canvas (same `outfitCollageLayout.ts` every other
     collage uses), but the canvas itself was small enough to make even a
     correctly-sized item read as tiny in absolute terms. Widened to `w-64`
     (256px). `CalendarScreen`'s own `DaySheet` collage (`w-32`) has the
     same structural issue but wasn't part of this feedback round — not
     touched here.
9. **Jacket/Coat widths unified at 2.3 boxes; Shorts re-centered; the
   troubleshoot-weather sliders' minutes-long stall fixed.** Jacket moved
   off its old dual-capped "contain" box onto the same `widthOnlyBox`
   mechanism Coat already used (see § Item collage sizing), and both are now
   2.3 boxes (Coat was 2.5). Shorts/Mini-Skirt's vertical center moved from
   row 3's own center to the D3/D4 divider, matching every other bottom-half
   garment. Separately — not a collage change — `utils/outfitDedup.ts`'s
   `dropAccessoryFreeDuplicates` was an all-pairs `O(n²)` scan
   (`outfits.some(...)` inside `outfits.filter(...)`), which was fine for
   `generateOutfits`' budget-capped results but was what actually made the
   Today screen's troubleshoot sliders (`generateClosestOutfits`, whose
   search is deliberately uncapped — see its own doc comment) take minutes
   on a well-stocked closet: tens of thousands of raw candidate outfits
   squared is billions of comparisons. Fixed by bucketing outfits by their
   non-accessory item set first (a match can only ever occur within one
   bucket — see `coreKey`'s own doc comment for why that's provably safe,
   not just a heuristic), turning the same comparisons into roughly
   `O(n × bucket size)`. See `utils/__tests__/outfitDedup.test.ts` for the
   regression guard.
10. **Top/T-Shirt/Shirt split into three independently-sized buckets;
    Sweater/Cardigan likewise.** Also fixed the actual root cause of a
    Coat/Bag/Jacket width mismatch that survived round 9's fix: not a
    collage bug at all — `background-framer/frame.py`'s `frame_cutout` was
    padding every cutout onto one shared 3:4 canvas regardless of the
    garment's own shape, so a naturally wide item (Bag) ended up nearly
    edge-to-edge in its own file while a naturally narrow one (Coat) got
    large invisible side-padding baked in — two categories with identical
    stated collage widths could render very differently depending on each
    specific photo's proportions. `frame_cutout` now applies `FRAME_MARGIN`
    independently on each axis, so the canvas keeps the garment's own aspect
    ratio instead of a forced one (`FRAME_ASPECT` removed). This only
    affects newly-processed photos, and only once the `background-framer`
    container is actually rebuilt and redeployed — editing the repo doesn't
    change a running container. See `background-framer/frame.py` and
    `background-framer/test_frame.py`.

    Separately, per explicit width requests: Top 2 → 1.5, T-Shirt stays 2,
    Shirt (new) 2.5, Sweater 2 → 2.3, Cardigan explicitly unchanged at 2.
    See § Item collage sizing for the full table and the mechanics of the
    bucket split.
11. **Palette gone fully neutral: `paper` white, `accent` desaturated.** Two
    changes, both per explicit feedback that the app's own chrome and CTA
    colour should never visually compete with a photographed garment's own
    colour:
    - `paper` (`#F7F7F7` → `#FFFFFF`, pure white). Round 2 already put the
      header, tab bar and every `BottomBar` footer on this one shared token
      specifically so top/bottom chrome reads as one surface (see § Chrome)
      — that mechanism is exactly what makes this a one-token change: white
      chrome without a separate edit to the header, tab bar or any
      individual `BottomBar` caller. Item photo backgrounds are unaffected —
      their grey gradient (`#F1F1F1` → `#F6F6F6`, see § Item grid rows) was
      never `paper` to begin with, so "the only grey left is item
      backgrounds" falls out of the existing separation rather than
      requiring a new one. `paper-2` (`#EFEFEF`) is untouched: it marks
      subtle panel separation *within* a screen's body content, not chrome
      or a background, and wasn't part of this feedback.
    - `accent`/`accent-muted` (oxblood `#6B1F2A`/`#8C4550` → `ink`/
      `ink-muted`'s own `#1A1714`/`#6B6259`). The original oxblood was a
      deliberate choice (see § Provenance) — this reverses it, not as a
      correction but as a different, later requirement: a completely
      neutral palette. The token names survive as their own entries rather
      than every call site being rewritten to `ink`/`ink-muted` directly —
      keeping "the single most prominent action or selected state on a
      screen" as its own named concept, per round 2's original reasoning
      for having the token at all, even though its value is now identical
      to `ink`'s. `success` (`#2E6E49`, the match-verdict green) is
      untouched — it's an informational verdict colour, not a decorative
      accent, and wasn't part of this feedback.

## Macrostructure family
This is a native app, not a marketing site — there is one family, "app
screens," not separate marketing/content families:

- **Grid screens** (Closet, Today's outfit grid) — Catalogue-family: a dense,
  uniform grid of the same kind of thing (garments, outfit candidates).
  Borderless imagery on a flat paper background; separation comes from
  whitespace and gutters, never a card border.
- **Index/calendar screens** (Calendar) — same Catalogue family, one cell per
  day; state (today / selected) reads through ink/accent color and a hairline
  underline, never a bordered box.
- **Detail/form screens** (Item Details, Add Item, Log Outfit, Archive,
  Crop, Match screens) — same palette, type, and CTA voice as the grid
  screens; fully swept in this pass (see § Per-screen allowances).

## Theme
RN/NativeWind has no native `oklch()`, so tokens are locked as hex with the
intended OKLCH read noted for provenance:

- `paper`        `#FFFFFF`  — pure white — amended from the neutral grey
  `#F7F7F7` (itself amended down from the original ivory `#FAF8F5`) per
  round 11: the app's own chrome and background must never read as
  competing with a photographed garment's own colour, and grey is reserved
  for the item photo backdrop gradient alone (see § Item grid rows), which
  was never this token
- `paper-2`      `#EFEFEF`  — oklch(~93% 0 0), a half-step down, for subtle panel separation without a border
- `ink`          `#1A1714`  — oklch(~16% 0.01 50), warm near-black, not pure #000 — kept warm on purpose: the *background* was the complaint, not the ink
- `ink-muted`    `#6B6259`  — oklch(~46% 0.015 55), secondary text/labels — 5.6:1 contrast on `#F7F7F7`, passes WCAG AA for normal text with margin
- `rule`         `#DEDEDE`  — oklch(~87% 0 0), neutral hairline dividers only — never a card border
- `accent`       `#1A1714`  — identical to `ink` — amended from oxblood
  `#6B1F2A` per round 11's move to a fully neutral palette; kept as its own
  token (not collapsed into `ink` at every call site) so "the single most
  prominent action on a screen" stays its own named concept for a future
  amendment to change again in one place
- `accent-muted` `#6B6259`  — identical to `ink-muted` — amended from
  `#8C4550` for the same reason as `accent` above
- `success`      `#2E6E49`  — oklch(~35% 0.08 145), muted green — the "match"
  verdict badge only (`ItemGrid.tsx`'s `BadgeCircle`); never a general
  accent. Kept separate from `accent` specifically so a positive verdict
  can't be mistaken for "just another button" — see § Amendments round 6.

`ink` on `#FFFFFF` is ~18.1:1; `ink-muted` on `#FFFFFF` is ~6.1:1 — both clear
WCAG AA (4.5:1) for normal text, which is what made the Closet brand-name
fix (below) a pure sizing change, not also a contrast fix.

## Typography
A full per-role system — every text role in the app maps to exactly one
named font token, and every token is a real static font file, not a
Tailwind font-weight utility layered on top of one (see the fontFamily
comment in `tailwind.config.js`: `font-medium`/`font-semibold`/etc. do
nothing once a named custom font is already set, since expo-google-fonts
ships one distinct font file per weight rather than a single variable font
with adjustable weight). Two families:

- **Playfair Display 400** (`font-title`) — screen titles only. Applied in
  `navigation/RootNavigator.tsx`'s `HEADER_STYLE` by raw `fontFamily`
  string (header options aren't styled through a className), so this is
  the one role with no Tailwind-side usage — `font-title` exists in the
  config for symmetry/future use, but the actual screen-title styling
  lives in the navigator.
- **Public Sans**, four weights, each a distinct named token:
  - `font-sans` (400) — category tabs, tab bar labels, list row labels,
    item labels/metadata, body copy/descriptions, and big statistic
    numbers *above* the large-size threshold (`text-4xl`+ — currently only
    Today's forecast temperature).
  - `font-sans-medium` (500) — "Wearing today", list row values, month
    title, days-of-week, buttons/CTAs, and section/modal headings that
    aren't a screen title (e.g. "Add a photo", `EmptyState` titles,
    `Form.tsx`'s picker-modal titles) — these read as prominent-but-not-
    editorial, the same register as a button.
  - `font-sans-semibold` (600) — emphasis: prices, counts (e.g. "{n} items
    selected").
  - `font-sans-light` (300) — big statistic numbers (a cost-per-wear
    figure, "£0 so far") at their normal size, below the large-size
    threshold. Same font file as `font-brand` below, kept as a separate
    token because that name is reserved for the brand-name role
    specifically.
- **`font-brand`** (Public Sans 300 Light) — an item's own brand name only,
  wherever it appears (`ItemGridRow`'s label band, `ArchiveScreen`'s rows,
  `OutfitMatchScreen`'s identified-item and pair-row captions) — not the
  display face. A light-weight sans reads "classy," not a heading. This
  landed on Public Sans Light after an initial pick (Archivo Bold, 700
  weight) read too heavy — Public Sans ships no 330 weight as a static font
  file (only 100/200/300/…/900), so 300 (Light) is the nearest available.
- **Calendar day numbers** are the one role with conditional weight, not a
  fixed one: `font-sans` (400) for today, the selected day, and any day
  with a logged outfit; `font-sans-light` (300, muted `ink-muted` colour)
  for every other day — past or future both read the same. See
  `CalendarCell` in `screens/CalendarScreen.tsx`.
- No mono, no separate label face — labels are just `font-sans` at
  `ink-muted`, per the studied DNA (Burberry's own "New In" / item-count
  labels carry no distinct styling either).
- **Closet brand-name text is `text-sm` (14px), not `text-xs` (12px).**
  Flagged as too small / possibly non-compliant; the fix is size, not
  colour — `ink` on `paper` already clears WCAG AA by a wide margin (see
  § Theme), the 12px size was the actual issue.
- Source Serif 4 and Archivo (the two previous display-face experiments)
  are both gone — no screen references either, and both packages were
  uninstalled. There is no lingering `font-display`/`font-display-medium`
  token; every former use of either was reassigned to one of the roles
  above during the sweep.

## Spacing
Unchanged — the existing Tailwind 4pt scale (`p-1`…`p-10` etc.) already
matches Hallmark's spacing discipline. What changes is *generosity*: grid
gutters and section padding widen where the redesign touches a screen.

## Touch targets
Interactive elements target ≥44px effective height (iOS's 44pt guidance,
used app-wide rather than switching by platform) and sit ≥20px from the
screen edge, not the WCAG 2.2 web-only 24×24 CSS px floor, which is a lower
bar than what a touch-first app should ship:
- Every fixed bottom action bar goes through `components/BottomBar.tsx`,
  which pads `px-5` (20px) from each screen edge, not `px-4`.
- A secondary button whose whole job is a single tap (`ArchiveScreen`'s
  Restore, `ClosetScreen`'s bulk Delete, `ItemDetailsScreen`'s photo
  action buttons, `Form.tsx`'s date-picker Done/Clear) is at least `py-3`,
  not `py-2`/`py-2.5` — the difference between a 33–38px target and a
  44–48px one.
- A button whose visible padding must stay small for layout reasons
  (`components/Chip.tsx`'s category tabs, header icon buttons) instead
  carries `hitSlop` to reach the same effective target without changing
  how it looks.
- No garment photo carries a shadow of any kind — tried as a flatlay
  effect in round 6, then explicitly reverted; `FramedImage` renders the
  image with no `shadow*` styling.

## The box-in-box rule
No image gets a bordered, rounded, white-backed "card" around it purely for
decoration, and nothing that already draws its own edge (`OutfitCollage`)
gets wrapped in a second bordered container.
- `components/OutfitCollage.tsx` is a borderless `paper` canvas — no border,
  no rounding beyond a hairline-safe minimum.
- `components/ItemGrid.tsx`'s photo cells carry no *border* by default; a
  border appears **only** as a real selection affordance during
  bulk-select, never decoratively. Each cell's grey gradient (see § Item
  grid rows) is a fill behind the photo, not a card wrapped around it — and
  critically, the white label band is a property of the *row*, not of any
  one cell, so there is no per-item card at all, not even an unbordered one.
- `screens/TodayScreen.tsx`'s outfit cards and thumbnail row lost their
  bordered/white-card wrapper — outfits are separated by whitespace and a
  hairline rule, not nested boxes.
- `screens/CalendarScreen.tsx`'s day cells lost their border entirely —
  today/selected state reads through ink/accent color + a hairline underline
  under the day number, not a ring around the cell.
- Same treatment applied to `screens/ArchiveScreen.tsx`'s rows and every
  other bordered-thumbnail spot found in the detail/form screens during the
  full sweep (see § Per-screen allowances).

## Item grid rows
`components/ItemGrid.tsx` (used by Closet, Log Outfit's item picker, and the
Matches browser — all three grids, per direct confirmation) renders **rows**,
not independent tiles. The white label band belongs to the row: a row of
flush garment photos, then one continuous band across the full row width for
their brand names, then the next row of photos. This is the correction to
round 1's per-tile bands (see § Amendments) — the white band is not, and must
never become again, a property of any single item.

- **`chunkIntoRows(items)`** splits the flat item list into `GRID_COLUMNS`
  (3) -wide groups; each group renders as one `ItemGridRow`.
- **Photo strip** — `GRID_COLUMNS` `PhotoCell`s in a `flex-row`, `flex-1`
  each, **zero gap** between them and no outer screen padding (`p-0` on the
  grid's own `FlatList` — genuinely edge-to-edge, confirmed over "small
  gutter between columns"). The horizontal padding each grid's `FlatList`
  content container used to carry (`p-2`/`p-3`) is gone entirely, so the
  grid's outer edges are flush with the screen too, not just flush between
  columns. Each cell's own backing is a left-to-right gradient, `#F1F1F1`
  → `#F6F6F6` (`expo-linear-gradient`, `start: {x:0,y:0}` → `end:
  {x:1,y:0}`) — not a Tailwind token, since `LinearGradient`'s `colors`
  prop needs real color values, not a className.
- **Label band** — one `flex-row bg-white` sitting directly beneath the
  photo strip, no gap, spanning the same full width. Pure `#FFFFFF`
  (Tailwind's `bg-white`, not `paper`). Each column holds that photo's
  brand name in `font-brand` (see § Typography), and — everywhere except
  the Closet grid — the category beneath it in the usual small `ink-muted`
  sans.
- **A short final row** (fewer than `GRID_COLUMNS` items) is padded with
  empty `flex-1` cells in *both* the photo strip and the label band, so
  columns still line up under a partial last row.
- **`showCategory` prop** (default `true`) controls the category line.
  `ClosetScreen.tsx` passes `showCategory={false}`: brand alone is the
  label there. Log Outfit's picker and the Matches browser pass nothing,
  so they keep the category line — removing it was a Closet-only request,
  not a rule for every `ItemGridRow` caller.

## Item collage sizing
`utils/outfitCollageLayout.ts` places each outfit item on a 5x5 grid (see
that file's own doc comments for the full column/row/z-index spec). Every
category is a "width-only" box: only the sizing axis is really constrained,
and the cross axis gets a generous, effectively uncapped allowance so
`resizeMode="contain"` can never bind on it instead of the stated width —
see `widthOnlyBox` and `GENEROUS_FREE_AXIS`. Jacket was the last holdout on
the old dual-capped "contain" box (both width and height stated) until
round 9 moved it onto the same mechanism as everything else, for the same
reason Top/Sweater moved off it earlier: a portrait-oriented cutout can hit
the height cap before reaching its stated width, silently rendering
narrower than the spec says.

Width-only category widths, in boxes (1 box = 20% of canvas width):
- **2.5 boxes** — Shirt (round 10)
- **2.3 boxes** — Jacket, Coat (round 9: both unified at 2.3; Coat was 2.5),
  Sweater (round 10: 2 → 2.3)
- **2 boxes** — Shoes/Boots/Sandals, Bag, Shorts/Mini-Skirt, T-Shirt (round
  10: split out of the old shared "generic Top" width, kept at 2), Cardigan
  (round 10: explicitly left unchanged at 2 while Sweater moved to 2.3),
  and every long bottom (long/mid/capri/cropped Pants, midi/maxi/knee-length
  Skirt, Leggings)
- **1.5 boxes** — Top (round 10: split out of the old shared "generic Top"
  width — narrowed from 2 to 1.5, the one category that shrank rather than
  grew), Belt (round 7 → round 8: 1 → 1.5; still deliberately narrower than
  a full garment, since a belt genuinely is a thinner accessory than a top,
  bottom, bag or coat)
- **1 box** — Tights (round 8: 0.75 → 1, a full box, per explicit
  instruction)
- **0.75 boxes** — Scarf

Top/T-Shirt/Shirt used to be one shared "generic Top" bucket/width (1.25
boxes before round 7, 2 boxes from round 7 through round 9) — split into
three separate buckets in round 10, each with its own width and its own
`Bucket` entry (`top`/`tshirt`/`shirt` in `outfitCollageLayout.ts`), since
they're no longer required to render identically. Same split for
Sweater/Cardigan, previously one shared 'sweater' bucket/width — now
`sweater` and `cardigan` are separate buckets. The "shift away from the
Sweater/Cardigan-occupied D2 slot" behavior (see `TOP_CENTER_WITH_SWEATER`)
still applies uniformly to whichever of Top/T-Shirt/Shirt is present,
gated on `hasSweaterLayer` (either bucket present), not tied to one bucket
name anymore. One consequence: a Base Layer tee (always a T-Shirt — see
`baseLayerCandidates`) only visually cascades against a main Top slot when
that slot *also* resolved to a T-Shirt; a Top- or Shirt-category main item
no longer shares a bucket with it at all, so the two render independently
rather than staggered.

Any future category added to this file should default to matching
T-Shirt/Cardigan's 2-box width unless there's a specific reason (like
Shirt's 2.5, Jacket/Coat/Sweater's 2.3, Top/Belt's 1.5, or Scarf's
genuinely thin 0.75) to differ — not default to something smaller "because
it's inside another layer."

Shorts/Mini-Skirt's vertical center moved from row 3's own center to the
D3/D4 divider in round 9 — matching every other bottom-half garment
(longBottom already centered there) rather than sitting visibly higher for
no real reason.

Beyond the stated box width, the *canvas* an `OutfitCollage` renders into
also has to be a reasonable absolute size — a correctly-proportioned item is
still a small item in pixels if the canvas itself is small. `LogOutfitScreen`
learned this the hard way (round 8): its preview sat in a fixed `w-40`
(160px) box, so items already sized right relative to that box still read as
tiny on screen. See § Amendments round 8.

## Startup
No app-launch splash. `App.tsx` used to gate `RootNavigator` behind an
"Opening your wardrobe…" full-screen spinner until the database and fonts
were both ready; it now renders the navigator on the very first frame.
Two things made that safe:
- `services/database.ts`'s `withDb` now awaits the memoized `initDatabase()`
  itself before every query, so a screen that queries the instant it mounts
  can never read a not-yet-migrated schema — the safety this used to come
  from App.tsx's own gate now lives at the query boundary instead.
- Fonts load in the background (`useFonts`'s result is no longer awaited
  before rendering); a screen's very first paint can briefly show the
  system fallback font before swapping to the real one a frame later. An
  accepted, one-time trade for not blocking the whole app on font loading.
The database-init *failure* state (not the loading state) still replaces
the whole tree — nothing in the app can function without the database, so
that one case is a genuine exception, not a loading gate.

## Chrome — top and bottom bars read as one surface
The header, the bottom tab bar, and every `components/BottomBar.tsx` footer
(Save/Log-outfit/Confirm bars, `VoiceCapture.tsx`'s recording bar) share the
exact same `paper` background and carry **no border** — see
`navigation/RootNavigator.tsx`'s `SURFACE_COLOR`/`TAB_BAR_STYLE` constants.
Previously the tab bar defaulted to plain white with a grey top border while
the header used the ivory palette — that mismatch, plus a border on every
`BottomBar`, was what read as "the top bar and bottom bar are different
colours & styles." Fixed by declaring one surface color once and applying it
everywhere chrome touches the screen edge, borderless throughout.

## Tabs — Closet's (and Log Outfit's) category filter row
`components/Chip.tsx` is a text tab with an ink underline when selected, not
a filled pill — matches the studied DNA directly (Burberry's own category
filter row is plain text links, not chip buttons). Shared by
`ClosetScreen.tsx` and `LogOutfitScreen.tsx`'s filter bars, so both updated
together.

## Motion
None added. No motion library exists in this project and the studied DNA is
typography-and-restraint-led — a busy reveal pattern would contradict it.

## Microinteractions stance
Silent success (no toasts). Existing loading/error states (spinners, inline
error text) unchanged — this pass is visual, not behavioral.

## CTA voice
- Primary: solid `ink` fill (or `accent` for the single most important action
  on a screen, e.g. "Wear this outfit" — visually identical to `ink` since
  round 11, see § Amendments, but kept as its own token for what it marks
  rather than what colour it currently renders as), `paper`-colored text,
  `rounded-sm` corners — not the previous `rounded-xl`/`rounded-2xl`/
  `rounded-full` (except genuine pills like pair-verdict circles and
  floating action buttons, which stay round on purpose).
- Secondary: `paper` fill, `rule`-colored 1px border, `ink` text.
- Destructive: unchanged rose fill — distinct from the rest of the neutral
  palette on purpose, so a delete action is never confusable with an
  ordinary button.
- Modal "Done" buttons (`Form.tsx`'s date/multi-select pickers) match the
  primary button voice (`rounded-sm bg-ink`), not a separate rounded-full
  treatment.

## Per-screen allowances
Every screen and shared component now reads the tokens above — the sweep
covers `screens/*.tsx`, `components/*.tsx`, `navigation/RootNavigator.tsx`,
and `App.tsx`. Nothing left on the old Tailwind `slate`/`emerald` palette
or the original hex values (`#0f172a`, `#94a3b8`, `#334155`, `#475569`,
`#059669`, `#64748b`). Grid/index screens (Closet, Today, Calendar) and the
detail/form/popup screens (Item Details, Add Item, Log Outfit, Archive,
Crop, Match screens, the outfit-photo matcher, the voice-capture bar) all
apply the same palette, type, box-in-box rule, and CTA voice — there is no
remaining "not yet swept" tier.

## What screens MUST share
- The palette tokens above (`paper`/`ink`/`accent`/`rule`) — no screen
  reaches for Tailwind's default `slate`/`emerald` for new UI going forward.
- The CTA voice (button fill, corner radius, border treatment).
- The box-in-box rule — no decorative card border around an image, ever.
- The chrome rule — header, tab bar, and every `BottomBar` share one
  borderless `paper` surface.

## What screens MAY differ on
- Which macrostructure-family a screen falls into (grid vs. form) — the
  family determines layout, not the tokens.
- Enrichment: none anywhere in this app; it's a personal utility, not a
  marketing surface.
