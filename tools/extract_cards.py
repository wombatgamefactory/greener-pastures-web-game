# -*- coding: utf-8 -*-
"""Extract packages/data/data/cards.json from the designer's spreadsheet.

Run:  python tools/extract_cards.py <path-to-sheet.xlsm>
  or:  GP_SHEET=<path> python tools/extract_cards.py

The sheet is DELIBERATELY not committed and its path is DELIBERATELY not
hard-coded here: this repo is published, the sheet is private design material,
and its filename names the game under its pitch title. Supply the path.

The sheet (worksheet "cards") is the upstream source of truth for card data;
packages/data/data/cards.json is what the game reads. Re-run this when a new
sheet version lands, then diff the JSON.

Authoritative columns are the @cost1..@cost6 icon columns, NOT the human-readable
"Build Cost" text column - the latter is lossy (it prints a total, "2 resources",
and says nothing about which crops satisfy it).

SCHEMA 2 (design changes v31, 02/09/2026). Every card is a single FLAT object -
there is no `faces` key and no `handSize`, `upgradeCostCoins` or `coins` anywhere.
The starter facts below are those of sheet v42 (16/09/2026).

  * ROW SELECTION. A row is a card when its `Needed` column is 1 (one row per
    physical card; all 105 rows carry it). `Qty` is NOT read: on v42 it is 0 on
    most rows. Any non-blank row that is not selected is reported by name.
  * A suit has THREE starters - Barn (ref 1), Farmstead (ref 2), Notice Board
    (ref 3) - plus an 18-card shuffled deck (refs 4..21). 105 cards in total.
  * Starters are SINGLE-FACED. A `U` row means a pre-v31 sheet and is an error.
    Starters are not bought: `buildCost` is null and printed VP is 0.
  * The Barn and Farmstead rows leave `Name` blank and print the name as the
    first line of `Ability`; that line becomes `name` and is removed from the
    text.
  * The Barn prints the own-crop scorer, "Game end: 1 VP for each <CROP> card
    you have built."
  * The Farmstead prints the six-receipt-slot line and no scoring.
  * The Notice Board prints its suit's power and the threshold `3+`, a minimum
    that never blocks, parsed here to the number 3. A visitor pays any card and
    the board is never a GROW target. The sheet's `wild` activation and
    `1 resource` build cost on the board are sheet decoration.
  * A starter's `activationType` is pinned to what the engine has always read
    (null, null, 'wild'), and the sheet is checked against the pin.
  * COINS ARE GONE from the game. A coin cost icon or a `£` in any card text is a
    stale sheet, and both are reported as errors.
  * Nothing is written to cards.json when a fatal check fails.

Keys are camelCase here so the JSON is the TypeScript shape with no mapping layer.
"""
import collections
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages" / "data" / "data" / "cards.json"

# Columns are resolved by HEADER TEXT, never pinned by letter, and a missing
# header is a hard error naming it. tools/make_web_assets.py already does this and
# says why; here is what it costs not to. A `Notes` column at R was deleted at
# sheet v22 and everything to its right shifted one place left, which repointed
# the cost block at @cost2..@cost6 PLUS `total_cost`. The crash that followed was
# luck: `icons = [i for i in icons if i]` drops falsy values, so a `total_cost` of
# 0 would have been filtered away silently and every card's build cost written
# one icon short, with no error at all. Only a non-zero total reached `icon_cost`
# and raised on an int.
COL_HEADERS = {
    "cardback": "Cardback", "suit": "Suit", "ref": "Ref", "type": "Type",
    "name": "Name", "buildCostText": "Build Cost", "activation": "Activation Cost",
    "threshold": "Threshold", "vp": "VP", "effect": "Activation Effect",
    "ability": "Ability",
}
COST_HEADERS = ["@cost%d" % i for i in range(1, 7)]
TOTAL_COST_HEADER = "total_cost"
CARD_NUM_HEADER = "Card#"
# One row per physical card carries `Needed` 1. `Qty` is deliberately not read:
# on v42 it is 0 on 75 of the 105 card rows, the Barn and Farmstead rows among
# them. (The 95-card extract of 16/09/2026 was caused by those rows leaving
# `Name` blank, not by `Qty`; see STARTER_NAMES.)
NEEDED_HEADER = "Needed"

TYPES = {"Starter": "starter", "Tier 1": "tier1", "Tier 2": "tier2",
         "Tier 3": "tier3", "Power": "power", "Endgame": "endgame"}

# The three starter slots, keyed by printed ref number (1/2/3).
STARTER_SLOT_BY_NUM = {1: "barn", 2: "farmstead", 3: "noticeboard"}

# --- Pinned mechanical stats ---------------------------------------------
# The Notice Board prints its threshold and activation type as columns, so both
# are READ from the sheet; the pin below exists so a silent sheet edit is caught
# rather than absorbed. RE-POINTED 10/09/2026 for the Notice Board visit
# (S8 of docs/notice-board-visit-handoff-2026-09-10-v2.md, sheet v36). The board
# is the VISIT TARGET again, and its threshold is the literal text `3+`: three is
# the MINIMUM before the owner may harvest, never a maximum load, so the face
# prints the plus sign and the cell is text rather than a number. The previous
# pin of 2 was a v31 fact and it described a different card.
NOTICE_BOARD_THRESHOLD = "3+"
# `Card.threshold` is `number | null` in packages/data/src/types.ts, so the
# printed `3+` is written to the JSON as the number 3. The plus sign is a rule
# (a minimum, never a block) that the engine carries in
# `rules.economy.noticeBoardBlocks`, not in the card data.
NOTICE_BOARD_THRESHOLD_VALUE = 3

# The printed name of each starter. v42 leaves `Name` blank on the Barn and
# Farmstead rows and prints the name as the first line of `Ability`.
STARTER_NAMES = {"barn": "Barn", "farmstead": "Farmstead", "noticeboard": "Notice Board"}

# The engine-facing activation type of each starter, pinned to the value
# cards.json has always carried. The sheet prints `wild` on the Notice Board as
# decoration (a visitor pays any card); it is checked against this pin, never
# trusted over it.
STARTER_ACTIVATION = {"barn": None, "farmstead": None, "noticeboard": "wild"}

# Build-cost text the sheet prints on a starter as decoration. A starter is
# never bought, so `buildCost` stays null whatever this says.
STARTER_BUILD_COST_DECORATION = {"noticeboard": "1 resource"}

# Every Power and Endgame card costs 2 cards of its OWN suit from v31; no coins,
# no wilds. Pinned for the same reason as the Notice Board threshold.
POWER_ENDGAME_COST = {"suit": 2, "wild": 0}

# Terms that named systems the game no longer has. Any of them in a card's text
# means the sheet is behind the rules, which is worth an error rather than a
# shrug: the sheet is the single source of truth for wording, so a stale string
# here is a stale string on the printed card.
RETIRED_TERMS = ("Hired Hand", "Hired Worker", "Working Week", "County Show",
                 "Hand size", "buy at market", "£")

# NO TEXT OVERRIDE LIVES HERE, deliberately. The sheet is the single source of
# truth for card wording, so the web game and the physical game cannot drift apart
# on rules text. The reference implementation carried an override on the Orchard
# Farmstead on the belief that the sheet was stale; that turned out to be a
# different resolution of the same design question rather than staleness, so the
# override is gone and the sheet wins. A ruling that changes wording is applied to
# the sheet first, then re-extracted.

# A warning containing any of these is a hard failure (non-zero exit), not a note.
# Each marks a SILENT sheet edit - a value the game depends on that changed
# upstream without anyone saying so - rather than a cosmetic quibble.
FATAL_MARKERS = ("expected", "cannot be loaded", "Notice Board", "unrecognised starter",
                 "coin cost icon", "upgraded 'U' row", "retired term", "starter")


def resolve_columns(ws):
    """Map every column this script reads onto its letter, by matching header text.

    Returns (col, cost_cols, total_cost, card_num, needed). Exits naming the header if the
    sheet does not carry it, because a `None` here is indistinguishable from an
    empty cell and would be absorbed into the extract rather than reported.
    """
    header = {}
    for i in range(1, ws.max_column + 1):
        v = ws.cell(row=1, column=i).value
        if v is not None and str(v).strip():
            header.setdefault(str(v).strip(), get_column_letter(i))

    missing = [h for h in list(COL_HEADERS.values()) + COST_HEADERS
               + [TOTAL_COST_HEADER, CARD_NUM_HEADER, NEEDED_HEADER] if h not in header]
    if missing:
        sys.exit("sheet worksheet 'cards' is missing %d required column header(s): %s"
                 % (len(missing), ", ".join(missing)))

    return ({k: header[h] for k, h in COL_HEADERS.items()},
            [header[h] for h in COST_HEADERS],
            header[TOTAL_COST_HEADER], header[CARD_NUM_HEADER], header[NEEDED_HEADER])


def sheet_path():
    """The sheet lives outside this repo. Path from argv[1] or $GP_SHEET."""
    positional = [x for x in sys.argv[1:] if not x.startswith("-")]
    raw = positional[0] if positional else os.environ.get("GP_SHEET")
    if not raw:
        sys.exit("usage: python tools/extract_cards.py <path-to-sheet.xlsm>\n"
                 "   or: set GP_SHEET to the sheet's path")
    p = Path(raw).expanduser()
    if not p.is_file():
        sys.exit("no such sheet: %s" % p)
    return p


def out_path():
    """Where the JSON lands. Defaults to the game's own cards.json.

    `--out` exists for the card sheet renderer, which extracts a WORKING COPY
    from the shared Google Sheet on every render. That copy must not overwrite
    `cards.json`: the sheet is allowed to be mid-thought, and a half-drawn
    experiment must not become the game's baseline behind anybody's back. The
    `--out` branch at the bottom of main() is what lets the renderer draw such a
    sheet anyway - refusing would make it useless exactly when a designer most
    wants to see the change.
    """
    if "--out" in sys.argv:
        return Path(sys.argv[sys.argv.index("--out") + 1]).expanduser()
    return OUT


# The printed TRIGGER PREFIX, stripped. From v17 the sheet prefixes a card's
# effect line with `GROW: ` or `ACTION: ` (Orchard and Vegetable carry it; the
# earlier suits do not, and Wheat's rows are unprefixed to this day). It is a
# LAYOUT label naming the trigger, not part of the effect sentence, and the
# trigger is already carried structurally in `abilityTrigger` - so keeping it
# would put the same fact in two places and make one suit's text read
# differently from another's for no reason. NOT a text override: nothing is
# rewritten, a prefix the art prints in its own right is simply not duplicated
# into the effect string.
TRIGGER_PREFIX = re.compile(r"^\s*(?:GROW|ACTION)\s*:\s*", re.IGNORECASE)


def clean(v):
    """Cells encode art line-breaks as a literal backslash-n."""
    if v is None:
        return None
    text = re.sub(r"[ \t]+\n", "\n", str(v).replace("\\n", "\n").strip())
    text = TRIGGER_PREFIX.sub("", text)
    return text or None


def icon_cost(icons):
    """suit_wheat.png -> 'suit'; suit_wild.png -> 'wild'.

    `coin_front.png` is counted separately so the caller can REPORT it. Coins left
    the game at v31, so a coin bar on the sheet is a stale row, and the count is
    never written into the JSON - `buildCost` carries `suit` and `wild` only.
    """
    c = collections.Counter()
    for i in icons:
        if i == "coin_front.png":
            c["coins"] += 1
        elif i == "suit_wild.png":
            c["wild"] += 1
        elif i.startswith("suit_"):
            c["suit"] += 1
        else:
            raise ValueError("unrecognised cost icon: %s" % i)
    return c


TRIGGER_PATTERNS = [
    ("autoHarvest", r"automatically harvests"),
    ("onHarvest", r"when (?:this card is )?harvested"),
    # The Deliver trigger vocabulary has two levels, selected by printed phrase.
    # Balloons were deleted from the game on 16/09/2026, so both now fire on
    # island deliveries only; the two keys are kept because the sheet still
    # prints both phrases.
    ("onDeliverIsland", r"when you deliver to the island"),
    ("onDeliver", r"when you deliver(?! to the island)"),
]
# The two surcharge triggers that used to live here, `harvestSurcharge` and
# `activationSurcharge`, both matched "must pay £1 to ...". Coins are gone, no
# card carries that wording any more, and a pattern that can never match is a
# pattern nobody maintains - so they went with the currency.

# A HARVEST RIDER LABEL. W4-W8 print a first line (the GROW effect) and then a
# labelled second line naming what happens when the FIELD is harvested. Up to
# v41 the label was `HARVEST:`; v42 prints `When Harvested:`. The detector has
# always read the labelled rider as part of an activated building (one
# trigger, `onActivate`) - the rider is implemented inside the suit handler,
# and nothing dispatches on `abilityTrigger` - so the new label is folded back
# to the old one before matching, keeping these cards' triggers unchanged
# rather than flagging them `['onActivate', 'onHarvest']` for review.
HARVEST_RIDER_LABEL = re.compile(r"(?m)^\s*when harvested\s*:")


def triggers_for(card_type, text, threshold=None, activation=None):
    """Detected trigger keywords. Compound/absent detections are flagged, not guessed.

    Keyword detection over the printed text, NOT a resolved ruling. needsDesignReview
    just means 0 or >1 triggers matched and a human must look.

    The one STRUCTURAL detection is `action`, and it is structural because it has
    to be: an ACTION card prints no prefix on the sheet, but it prints no threshold
    and no activation type either, so it can be neither grown nor sown. A tier card
    with text and no way to be activated fires as a main action instead.

    Starters return no trigger. That is unchanged from schema 1, and it is worth
    naming because the Barn prints an end-game scorer: its VP is counted by the
    engine's scoring pass off the card's identity, not off this array.
    """
    if card_type == "power":
        low = (text or "").lower()
        deliver = [name for name, pat in TRIGGER_PATTERNS
                   if name.startswith("onDeliver") and re.search(pat, low)]
        return ["passive"] + deliver, False
    if card_type == "endgame":
        return ["gameEnd"], False
    if card_type == "starter" or not text:
        return [], False
    if threshold is None and activation is None:
        return ["action"], False

    low = HARVEST_RIDER_LABEL.sub("harvest:", text.lower())
    found = [name for name, pat in TRIGGER_PATTERNS if re.search(pat, low)]
    starts_on_harvest = re.match(
        r"^\s*(this building automatically|when (?:this card is )?harvested)", low)
    if not starts_on_harvest:
        found.insert(0, "onActivate")
    ambiguous = len(found) != 1
    return found, ambiguous


def check_starter(card, sheet, warnings):
    """Check one starter against the v42 facts (re-pointed 16/09/2026).

    `card` is the record being written; `sheet` holds the RAW printed cells
    (`threshold`, `activation`, `buildCostText`), which the record does not keep.

      * NOTICE BOARD: the visit target. Prints its suit's power and the threshold
        `3+` (a minimum that never blocks; written as 3). A visitor pays any card
        and the board is never a GROW target, so the printed `wild` activation
        and `1 resource` build cost are sheet decoration, checked against pins.
      * BARN: prints the own-crop scorer, "Game end: 1 VP for each <CROP> card
        you have built." No threshold, no activation.
      * FARMSTEAD: prints the six-receipt-slot line and no scoring. No
        threshold, no activation.

    Every warning here names the Notice Board or the word "starter", so each is
    fatal (FATAL_MARKERS).
    """
    slot, cid = card["slot"], card["id"]
    if slot is None:
        return
    label = "%s: starter %s" % (cid, STARTER_NAMES[slot])

    if card["name"] != STARTER_NAMES[slot]:
        warnings.append("%s: printed name is %r" % (label, card["name"]))

    pinned = STARTER_ACTIVATION[slot]
    if sheet["activation"] != pinned:
        warnings.append("%s: sheet prints activation %r, pinned engine value is %r"
                        % (label, sheet["activation"], pinned))

    decoration = STARTER_BUILD_COST_DECORATION.get(slot)
    if sheet["buildCostText"] not in (None, decoration):
        warnings.append("%s: sheet prints build cost %r; a starter is never bought"
                        % (label, sheet["buildCostText"]))

    if slot == "noticeboard":
        if str(sheet["threshold"] or "").strip() != NOTICE_BOARD_THRESHOLD:
            warnings.append("%s: must print threshold %r, the floor the owner harvests "
                            "at (sheet says %r)"
                            % (label, NOTICE_BOARD_THRESHOLD, sheet["threshold"]))
        if not card["abilityText"] or card["abilityText"].upper().startswith("VISITOR"):
            warnings.append("%s: must print its suit's power (sheet says %r)"
                            % (label, card["abilityText"]))
        return

    if sheet["threshold"] is not None:
        warnings.append("%s: cannot be loaded, so it must print no threshold (sheet "
                        "says %r)" % (label, sheet["threshold"]))

    text = card["abilityText"]
    if slot == "barn":
        scorer = "Game end: 1 VP for each %s card you have built." % card["suit"].capitalize()
        if text != scorer:
            warnings.append("%s: must print the own-crop scorer %r (sheet says %r)"
                            % (label, scorer, text))
    if slot == "farmstead":
        low = text.lower()
        if "receipt" not in low or "6" not in low or "vp" in low:
            warnings.append("%s: must print the six-receipt-slot line and no scoring "
                            "(sheet says %r)" % (label, text))


def g_cardnum(ws, card_num_col, r):
    """The `Card#` cell as a string. Its own helper only because the U-row guard
    reads it before the row is otherwise parsed."""
    return str(ws["%s%d" % (card_num_col, r)].value or "").strip()


def main():
    xlsm = sheet_path()
    digest = hashlib.sha256(xlsm.read_bytes()).hexdigest()
    wb = openpyxl.load_workbook(xlsm, data_only=True)
    ws = wb["cards"]
    col, cost_cols, total_cost_col, card_num_col, needed_col = resolve_columns(ws)

    cards, warnings, uncached, skipped = {}, [], [], []

    for r in range(2, ws.max_row + 1):
        def g(c, _r=r):
            return ws["%s%d" % (col[c], _r)].value

        suit, ref, ctype, name = g("suit"), g("ref"), g("type"), g("name")
        needed = ws["%s%d" % (needed_col, r)].value

        # ROW SELECTION is by `Needed`, never by `Qty` and never by `Name`. v42
        # leaves `Name` blank on the ten Barn and Farmstead rows, and the old
        # "every field filled" filter dropped them without a word (a 95-card
        # extract). Every non-blank row that is not selected is now named.
        if needed in (None, "", 0):
            if any(v not in (None, "") for v in (suit, ref, ctype, name)):
                skipped.append("r%d %s %s (%s, Needed=%r)"
                               % (r, ref or "-", clean(name) or "-", ctype or "-", needed))
            continue
        if needed != 1:
            warnings.append("r%d %s: Needed=%r, expected 1 (one row per physical card)"
                            % (r, ref, needed))
        if not (suit and ref and ctype):
            warnings.append("r%d %s: a Needed row is missing Suit/Ref/Type, expected all "
                            "three (suit=%r ref=%r type=%r)" % (r, name, suit, ref, ctype))
            continue
        if ctype not in TYPES:
            warnings.append("r%d: skipped unknown type %r" % (r, ctype))
            continue

        # v31 deleted the starter-upgrade rule and, with it, the fifteen `NNU`
        # rows that carried the upgraded faces. Schema 1 paired the two rows on
        # `Ref` and emitted a `faces` object; there is nothing to pair now, so a
        # surviving `U` row can only mean a pre-v31 sheet was passed in. Reported
        # rather than absorbed: silently dropping it would extract a sheet the
        # caller thinks is current, and silently keeping it would put a phantom
        # 16th card in a suit.
        ref = str(ref).strip()
        if ref.upper().endswith("U") or str(g_cardnum(ws, card_num_col, r)).upper().endswith("U"):
            warnings.append("r%d %s: upgraded 'U' row found -- starters are single-faced "
                            "from v31 and all fifteen U rows were deleted from the sheet. "
                            "This looks like a pre-v31 sheet." % (r, ref))
            continue

        ctype = TYPES[ctype]
        suit = suit.lower()
        icons = [ws["%s%d" % (c, r)].value for c in cost_cols]
        icons = [i for i in icons if i]
        # `total_cost` is the sheet's own =COUNTA() over the icon block, read here
        # as a cross-check that the icon columns still line up (the v22 column
        # shift that this file's header comment describes was caught by exactly
        # this). It is a CACHED formula value, and openpyxl drops the cache when
        # it saves - so a sheet whose last writer was a script, not Excel, has an
        # empty cache on every row. That is not a data error and must not shout:
        # counted once, reported once, and the cross-check simply cannot run.
        total = ws["%s%d" % (total_cost_col, r)].value
        if total is None or total == "":
            uncached.append(ref)
        elif total != len(icons):
            warnings.append("r%d %s: totalCost=%s but %d cost icons" % (r, ref, total, len(icons)))
        cost = icon_cost(icons)
        if cost["coins"]:
            warnings.append("r%d %s: %d coin cost icon(s) -- coins were removed from the "
                            "game at v31 and never reach the JSON" % (r, ref, cost["coins"]))

        vp = g("vp") or 0
        threshold = g("threshold")
        activation = clean(g("activation"))

        # RULED (Dean, 2026-08-13): the two text columns mean something. A card
        # with an ACTIVATION power prints in `Activation Effect`; a card with a
        # STATIC effect prints in `Ability`. So the Barn and the Farmstead, both
        # passive, live in `Ability`, while the Notice Board - the one loadable
        # starter - keeps its VISITOR text in `Activation Effect`. Read whichever
        # is filled, for every card type alike.
        text = clean(g("effect")) or clean(g("ability"))

        stale = [t for t in RETIRED_TERMS if t.lower() in (text or "").lower()]
        if stale:
            warnings.append("r%d %s: retired term(s) %s in the printed text %r"
                            % (r, ref, ", ".join(repr(s) for s in stale), text))

        if ctype == "starter":
            slot = STARTER_SLOT_BY_NUM.get(int(re.sub(r"\D", "", ref) or 0))
            if not slot:
                warnings.append("r%d %s: unrecognised starter ref" % (r, ref))
            if icons:
                warnings.append("r%d %s: a starter is not bought, so it must carry no cost "
                                "icons (found %s)" % (r, ref, dict(cost)))
            if vp:
                warnings.append("r%d %s: starter printed VP is %s, expected 0" % (r, ref, vp))
            # v42 prints the Barn and Farmstead names as the first line of
            # `Ability` and leaves `Name` blank. The heading is lifted into
            # `name` so the text carries the rules line alone.
            name = clean(name)
            if not name and slot and text:
                first, _, rest = text.partition("\n")
                if first.strip() == STARTER_NAMES[slot]:
                    name, text = first.strip(), rest.strip()
            cards[(suit, ref)] = {
                "id": ref, "suit": suit, "type": "starter", "slot": slot,
                "name": name, "inDeck": False, "enabled": True,
                "buildCost": None,
                "activationType": STARTER_ACTIVATION.get(slot),
                "threshold": (NOTICE_BOARD_THRESHOLD_VALUE if slot == "noticeboard"
                              else None),
                "printedVp": 0,
                "abilityText": text or "",
                "abilityTrigger": [], "needsDesignReview": False,
            }
            check_starter(cards[(suit, ref)],
                          {"threshold": threshold, "activation": activation,
                           "buildCostText": clean(g("buildCostText"))},
                          warnings)
            continue

        if isinstance(threshold, float) and threshold.is_integer():
            threshold = int(threshold)
        if threshold is not None and not isinstance(threshold, int):
            if str(threshold).strip().isdigit():
                threshold = int(str(threshold).strip())
            else:
                warnings.append("r%d %s: threshold %r, expected a whole number"
                                % (r, ref, threshold))

        trigger, ambiguous = triggers_for(ctype, text, threshold, activation)
        build_cost = {"suit": cost["suit"], "wild": cost["wild"]}
        if ctype in ("power", "endgame") and build_cost != POWER_ENDGAME_COST:
            warnings.append("r%d %s: %s card build cost %s, expected %s (2 cards of its "
                            "own suit, ruled 02/09/2026)"
                            % (r, ref, ctype, build_cost, POWER_ENDGAME_COST))
        cards[(suit, ref)] = {
            "id": ref, "suit": suit, "type": ctype, "name": clean(name), "inDeck": True,
            "enabled": True,
            "buildCost": build_cost,
            "activationType": activation, "threshold": threshold, "printedVp": vp,
            "abilityText": text or "",
            "abilityTrigger": trigger,
            "needsDesignReview": ambiguous,
        }

    ordered = sorted(cards.values(), key=lambda c: (c["suit"], int(re.sub(r"\D", "", c["id"]))))

    # --- validation -------------------------------------------------------
    by_suit = collections.Counter(c["suit"] for c in ordered)
    by_type = collections.Counter((c["suit"], c["type"]) for c in ordered)
    expect = {"starter": 3, "tier1": 5, "tier2": 4, "tier3": 3, "power": 3, "endgame": 3}
    for suit in by_suit:
        for t, n in expect.items():
            if by_type[(suit, t)] != n:
                warnings.append("%s: expected %d %s, found %d" % (suit, n, t, by_type[(suit, t)]))
        deck = sum(1 for c in ordered if c["suit"] == suit and c["inDeck"])
        if deck != 18:
            warnings.append("%s: expected 18 shuffled deck cards, found %d" % (suit, deck))
        slots = sorted(c["slot"] for c in ordered if c["suit"] == suit and not c["inDeck"])
        if slots != ["barn", "farmstead", "noticeboard"]:
            warnings.append("%s: expected the three starter slots, found %s" % (suit, slots))
    if len(ordered) != 105:
        warnings.append("expected 105 cards total (5 x (3 starters + 18 deck)), found %d"
                        % len(ordered))
    if uncached:
        note = ("%d row(s) carry no cached total_cost, so the icon-block cross-check "
                "could not run on them. Expected when the sheet was last written by a "
                "script: openpyxl drops formula caches on save, and Excel refills them "
                "the next time the file is opened and saved." % len(uncached))
        if len(uncached) == len(ordered):
            print("note: " + note)
        else:
            warnings.append(note)

    doc = {
        "meta": {
            "schemaVersion": 2,
            "kind": "generated",
            "generatedBy": "tools/extract_cards.py",
            "sourceSheet": "worksheet 'cards' of the designer spreadsheet (kept outside this repo)",
            "sourceSha256": digest,
            "notes": [
                "buildCost is derived from the @cost1..@cost6 icon columns, which are"
                " authoritative; the sheet's 'Build Cost' text column is lossy (it prints"
                " a total and does not say which crops satisfy it).",
                "A suit has THREE starters - Barn (ref 1), Farmstead (ref 2), Notice Board"
                " (ref 3) - plus the 18-card deck (refs 4..21). 105 cards total"
                " (15 starters + 90 deck).",
                "Schema 2 (design changes v31, 02/09/2026) is FLAT: every card is one"
                " object with no nested per-side block. Starters lost their upgraded side"
                " along with the starter-upgrade rule; the hand-limit field went with the"
                " hand limit, the starter-upgrade price went with the upgrade, and the"
                " money term of a build cost went with money itself. A build cost is now"
                " exactly {suit, wild}. Anything the schema-1 shape carried and this one"
                " does not is deliberate, not missing.",
                "Starters (sheet v42) are not bought: buildCost is null and printedVp is 0"
                " on all fifteen. The Barn prints the own-crop scorer ('Game end: 1 VP for"
                " each <CROP> card you have built.'). The Farmstead prints the six"
                " receipt-slot line and no scoring. The Notice Board prints its suit's"
                " power and the threshold '3+', a minimum that never blocks, written here"
                " as the number 3; a visitor pays any card and the board is never a GROW"
                " target. Starter activationType is pinned (Barn and Farmstead null,"
                " Notice Board 'wild'); the sheet's 'wild' and '1 resource' on the board"
                " are decoration.",
                "Rows are selected by the sheet's 'Needed' column (1 per card), not by"
                " 'Qty'. The Barn and Farmstead rows print their name as the first line of"
                " 'Ability'; it is moved into name.",
                "Power cards print no VP on v42 (printedVp 0).",
                "Every Power and Endgame card costs 2 cards of its own suit"
                " ({suit: 2, wild: 0}). Money does not exist in the game from v31, so no"
                " monetary term reaches this file; a money icon still printed on the"
                " sheet's cost bar is reported as an error rather than absorbed.",
                "No card text is ever rewritten here. The sheet is the single source of"
                " truth for wording, so the web game and the physical game cannot drift"
                " apart on rules text; the tuning overlay carries numbers and flags only."
                " A ruling that changes wording is applied to the sheet first, then"
                " re-extracted.",
                "Every card carries `enabled: true`. It is a tuning-overlay flag, not a"
                " printed property: switching a card off is how a paired comparison run"
                " asks whether the game is better without it.",
                "abilityTrigger is keyword detection over the printed text, not a resolved"
                " ruling. needsDesignReview=true means 0 or >1 triggers matched, and those"
                " cards are re-read by hand when their handlers are written. Starters carry"
                " no trigger at all - the Barn's end-game VP is counted by the engine's"
                " scoring pass off the card's identity, not off this array. A"
                " 'When Harvested:' rider line (W4-W8, v42) is read like the old"
                " 'HARVEST:' label, so those cards stay ['onActivate'].",
                "The one STRUCTURAL trigger is `action`: a tier card with printed text but"
                " no threshold and no activation type can be neither grown nor sown, so its"
                " text fires as a MAIN ACTION instead - taken in place of Draw, Build, Grow,"
                " Harvest or Deliver. The sheet prints no prefix for it, which is why it is"
                " read off the shape of the card rather than off a keyword.",
                "The Deliver trigger has TWO keys: onDeliver ('When you Deliver...') and"
                " onDeliverIsland ('When you Deliver to the island...'). Balloons were"
                " deleted on 16/09/2026, so both fire on island deliveries only.",
            ],
        },
        "suits": sorted(by_suit),
        "catalogue": ordered,
    }
    out = out_path()
    is_baseline = out.resolve() == OUT.resolve()

    review = [c["id"] for c in ordered if c["needsDesignReview"]]
    shuffled = sum(c["inDeck"] for c in ordered)
    print("extracted %d cards (%d shuffled, %d starters)"
          % (len(ordered), shuffled, len(ordered) - shuffled))
    print("source sha256: %s" % digest)
    print("per suit: %s" % dict(by_suit))
    print("ambiguous abilityTrigger (%d): %s" % (len(review), " ".join(review)))
    if skipped:
        print("\nskipped %d non-blank row(s) with no Needed count:" % len(skipped))
        for s in skipped:
            print("  - %s" % s)
    if warnings:
        print("\n%d warning(s):" % len(warnings))
        for w in warnings:
            print("  - %s" % w)

    # The fatal check runs BEFORE anything is written, so a failing run leaves
    # cards.json exactly as it was (it used to be overwritten and then the run
    # failed).
    fatal = [w for w in warnings if any(m in w for m in FATAL_MARKERS)]
    if fatal and is_baseline:
        print("\n%d of those break a rule the GAME enforces. Nothing written; %s is "
              "unchanged." % (len(fatal), out))
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, not text: write_text would turn every newline into CRLF on Windows.
    out.write_bytes((json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    print("\nwrote %s" % out)
    if fatal:
        # A `--out` copy that is not cards.json is a proof render of whatever the
        # sheet currently says (tools/sheet-cards.mjs relies on this), and the
        # sheet is allowed to be mid-thought. Refusing to draw it would make the
        # renderer useless exactly when a designer most wants to see the change.
        print("%d of those break a rule the GAME enforces. Written anyway: %s is a "
              "proof copy, not the baseline." % (len(fatal), out.name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
