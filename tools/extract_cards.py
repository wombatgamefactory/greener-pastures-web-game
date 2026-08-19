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
"Build Cost" text column - the latter is lossy (one card reads "4 dairy" but its
icons are dairy x3 + wild x1).

SCHEMA 1. A suit has THREE starters - Barn (ref 1), Farmstead (ref 2), Notice
Board (ref 3) - plus an 18-card shuffled deck (refs 4..21). Each starter has a
base row (Card# = an integer) and an upgraded "U" row (Card# = "NNU"); the base
row carries a combined "base\\nUpgrade:..." cell that is split into the base face
here, and the U row carries the full upgraded face. The only loadable starter is
the Notice Board (threshold 5 / wild); the Farmstead is a passive suit-power card
with no stack.

Derived from the reference implementation's extractor at its schema v3. Keys are
camelCase here so the JSON is the TypeScript shape with no mapping layer.
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
COST_HEADERS = [f"@cost{i}" for i in range(1, 7)]
TOTAL_COST_HEADER = "total_cost"
CARD_NUM_HEADER = "Card#"

TYPES = {"Starter": "starter", "Tier 1": "tier1", "Tier 2": "tier2",
         "Tier 3": "tier3", "Power": "power", "Endgame": "endgame"}

# The three starter slots, keyed by printed ref number (1/2/3).
STARTER_SLOT_BY_NUM = {1: "barn", 2: "farmstead", 3: "noticeboard"}

# The Farmstead's cost bar used to print a MILESTONE rather than a price - three
# own-crop icons, the buildings that flipped it free (ticket 46). Dean retired
# that rule on 2026-08-12: all three starters are bought for £2, so the sheet is
# now checked for the same 2-coin bar on all of them.

# --- Starter mechanical stats --------------------------------------------
# The Notice Board prints threshold 5 / wild on both faces, and the Barn prints
# its hand size in its face text; both are READ from the sheet. The tables below
# PIN the expected values so a silent sheet edit is caught rather than absorbed.
# The Orchard barn base face prints 4 (its draw power is paid for with a tight
# hand); its upgraded face prints 7.
# Dairy moved 6/8 -> 5/7 in the Dairy rebalance v1 (sheet v21, 2026-08-12,
# docs/dairy-rebalance-v1.md): it held the largest hand in the game on the suit
# that needs the fewest cards. Its Barn's SHED build hook went Draw 2 -> Draw 1
# in the same pass; that is text, so it is not pinned here.
BARN_HAND_SIZE = {
    "wheat": (5, 7), "apiary": (5, 7), "dairy": (5, 7),
    "orchard": (4, 7), "vegetable": (5, 7),
}
NOTICE_BOARD_THRESHOLD = 5

# NO TEXT OVERRIDE LIVES HERE, deliberately. The sheet is the single source of
# truth for card wording, so the web game and the physical game cannot drift apart
# on rules text. The reference implementation carried an override on the Orchard
# Farmstead on the belief that the sheet was stale; that turned out to be a
# different resolution of the same design question rather than staleness, so the
# override is gone and the sheet wins. A ruling that changes wording is applied to
# the sheet first, then re-extracted.

# A warning containing any of these is a hard failure (non-zero exit), not a note.
FATAL_MARKERS = ("expected", "cannot be loaded", "Notice Board", "hand size",
                 "unrecognised starter")


def resolve_columns(ws):
    """Map every column this script reads onto its letter, by matching header text.

    Returns (col, cost_cols, total_cost, card_num). Exits naming the header if the
    sheet does not carry it, because a `None` here is indistinguishable from an
    empty cell and would be absorbed into the extract rather than reported.
    """
    header = {}
    for i in range(1, ws.max_column + 1):
        v = ws.cell(row=1, column=i).value
        if v is not None and str(v).strip():
            header.setdefault(str(v).strip(), get_column_letter(i))

    missing = [h for h in list(COL_HEADERS.values()) + COST_HEADERS
               + [TOTAL_COST_HEADER, CARD_NUM_HEADER] if h not in header]
    if missing:
        sys.exit(f"sheet worksheet 'cards' is missing {len(missing)} required "
                 f"column header(s): {', '.join(missing)}")

    return ({k: header[h] for k, h in COL_HEADERS.items()},
            [header[h] for h in COST_HEADERS],
            header[TOTAL_COST_HEADER], header[CARD_NUM_HEADER])


def sheet_path():
    """The sheet lives outside this repo. Path from argv[1] or $GP_SHEET."""
    raw = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GP_SHEET")
    if not raw:
        sys.exit("usage: python tools/extract_cards.py <path-to-sheet.xlsm>\n"
                 "   or: set GP_SHEET to the sheet's path")
    p = Path(raw).expanduser()
    if not p.is_file():
        sys.exit(f"no such sheet: {p}")
    return p


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
    # RULED override (owner 2026-07-16): the game says "Hired Worker"; the
    # sheet's "Hired Hand" strings are stale (flagged for the next sheet edit).
    # No card is *named* "Hired Hand", so a global replace is safe.
    text = text.replace("Hired Hand", "Hired Worker")
    text = TRIGGER_PREFIX.sub("", text)
    return text or None


def base_face_text(text):
    """A base starter cell holds `base\\nUpgrade: <upgraded>`; keep only the base half.
    The upgraded face is taken from the separate `U` row, which is authoritative."""
    if text is None:
        return None
    return re.split(r"\n\s*Upgrade\s*:?", text, maxsplit=1, flags=re.IGNORECASE)[0].strip() or None


def hand_size_in(text):
    """Parse the absolute hand size a Barn face prints ("Hand size 5."), or None."""
    m = re.search(r"hand size\s+(\d+)", text or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


def icon_cost(icons):
    """suit_wheat.png -> 'suit'; suit_wild.png -> 'wild'; coin_front.png -> 'coins'."""
    c = collections.Counter()
    for i in icons:
        if i == "coin_front.png":
            c["coins"] += 1
        elif i == "suit_wild.png":
            c["wild"] += 1
        elif i.startswith("suit_"):
            c["suit"] += 1
        else:
            raise ValueError(f"unrecognised cost icon: {i}")
    return c


TRIGGER_PATTERNS = [
    ("autoHarvest", r"automatically harvests"),
    ("onHarvest", r"when (?:this card is )?harvested"),
    # The Deliver trigger vocabulary has two levels, selected by printed phrase.
    # "When you Deliver..." fires on island claims AND balloon moves;
    # "When you Deliver to the island..." fires on island claims only.
    ("onDeliverIsland", r"when you deliver to the island"),
    ("onDeliver", r"when you deliver(?! to the island)"),
    ("harvestSurcharge", r"must pay .1 to harvest"),
    ("activationSurcharge", r"must pay .1 to activate"),
]


def triggers_for(card_type, text, threshold=None, activation=None):
    """Detected trigger keywords. Compound/absent detections are flagged, not guessed.

    Keyword detection over the printed text, NOT a resolved ruling. needsDesignReview
    just means 0 or >1 triggers matched and a human must look.

    The one STRUCTURAL detection is `action`, and it is structural because it has
    to be: an ACTION card prints no prefix on the sheet, but it prints no threshold
    and no activation type either, so it can be neither grown nor sown. A tier card
    with text and no way to be activated fires as a main action instead."""
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

    low = text.lower()
    found = [name for name, pat in TRIGGER_PATTERNS if re.search(pat, low)]
    starts_on_harvest = re.match(r"^\s*(this building automatically|when (?:this card is )?harvested)", low)
    if not starts_on_harvest and "harvestSurcharge" not in found:
        found.insert(0, "onActivate")
    ambiguous = len(found) != 1
    return found, ambiguous


def merge_starter_stats(card, faces):
    """Check a starter's two faces and add the printed-on-art stats absent as columns.

    The Notice Board is the only loadable starter (threshold 5 / wild); the Barn and
    the Farmstead hold no cards, so they must print neither threshold nor activation.
    The Barn also carries a parsed absolute `handSize` on each face.
    """
    slot = card["slot"]
    suit = card["suit"]
    starter, upgraded = faces["starter"], faces["upgraded"]
    warnings = []

    if slot == "noticeboard":
        for side, face in (("starter", starter), ("upgraded", upgraded)):
            if (face["threshold"], face["activationType"]) != (NOTICE_BOARD_THRESHOLD, "wild"):
                warnings.append(f"{card['id']}: Notice Board {side} face must be threshold "
                                f"{NOTICE_BOARD_THRESHOLD} / wild activation "
                                f"(sheet says {face['threshold']} / {face['activationType']!r})")
        return warnings

    for side, face in (("starter", starter), ("upgraded", upgraded)):
        if face["threshold"] is not None or face["activationType"] is not None:
            warnings.append(f"{card['id']}: {slot} {side} face cannot be loaded, so it must have "
                            f"no threshold and no activation type")

    if slot == "barn":
        expected = BARN_HAND_SIZE[suit]
        for i, (side, face) in enumerate((("starter", starter), ("upgraded", upgraded))):
            hs = hand_size_in(face["abilityText"])
            face["handSize"] = hs
            if hs is None:
                warnings.append(f"{card['id']}: Barn {side} face prints no readable hand size")
            elif hs != expected[i]:
                warnings.append(f"{card['id']}: Barn {side} hand size {hs} != pinned {expected[i]} "
                                f"-- the sheet changed, verify and update BARN_HAND_SIZE")
    return warnings


def build_face(name, vp, threshold, activation, text):
    return {
        "name": name, "printedVp": vp, "threshold": threshold,
        "activationType": activation, "abilityText": text,
    }


def main():
    xlsm = sheet_path()
    digest = hashlib.sha256(xlsm.read_bytes()).hexdigest()
    wb = openpyxl.load_workbook(xlsm, data_only=True)
    ws = wb["cards"]
    col, cost_cols, total_cost_col, card_num_col = resolve_columns(ws)

    cards, faces, warnings = {}, {}, []

    for r in range(2, ws.max_row + 1):
        g = lambda c: ws[f"{col[c]}{r}"].value
        suit, ref, ctype, name = g("suit"), g("ref"), g("type"), g("name")
        if not (suit and ref and ctype and name):
            if ctype == "Free Port":
                warnings.append(f"r{r}: skipped '{ctype}' row -- the Aerodrome is a per-player "
                                f"board, not a deck card; it lives in data/aerodrome.json")
            continue
        if ctype not in TYPES:
            warnings.append(f"r{r}: skipped unknown type {ctype!r}")
            continue

        ctype = TYPES[ctype]
        suit = suit.lower()
        icons = [ws[f"{c}{r}"].value for c in cost_cols]
        icons = [i for i in icons if i]
        total = ws[f"{total_cost_col}{r}"].value or 0
        if total != len(icons):
            warnings.append(f"r{r} {ref}: totalCost={total} but {len(icons)} cost icons")
        cost = icon_cost(icons)

        upgraded = str(ws[f"{card_num_col}{r}"].value or "").endswith("U")
        vp = g("vp") or 0
        threshold = g("threshold")
        activation = clean(g("activation"))

        if ctype == "starter":
            # The base row carries `base\nUpgrade:...`; the U row carries the full upgraded face.
            #
            # RULED (Dean, 2026-08-13): the two text columns mean something. A card
            # with an ACTIVATION power prints in `Activation Effect`; a card with a
            # STATIC effect prints in `Ability`. So a Barn and a Farmstead, both
            # passive, moved to `Ability` at sheet v22, while the Notice Board -
            # the one loadable starter - keeps its VISITOR text in `Activation
            # Effect`. Read whichever is filled, exactly as the deck-card branch
            # below already does. Reading only `Activation Effect` here cost 10
            # Barn warnings AND silently blanked all 10 Farmstead faces, which are
            # the suit-power cards.
            side = "upgraded" if upgraded else "starter"
            text = clean(g("effect")) or clean(g("ability"))
            if not upgraded:
                text = base_face_text(text)
            face = build_face(clean(name), vp, threshold, activation, text)

            key = (suit, ref)
            faces.setdefault(key, {})[side] = face
            if not upgraded:
                slot = STARTER_SLOT_BY_NUM.get(int(re.sub(r"\D", "", ref)))
                if not slot:
                    warnings.append(f"r{r} {ref}: unrecognised starter ref")
                # All three starters are bought for £2 (Dean, 2026-08-12). The
                # Farmstead's own-crop milestone bar is retired with the rule it
                # printed, so one shape is now checked for all of them. Both sheet
                # edits this used to wait on have landed and are verified: the
                # "Flips free when you have 3 X buildings." line came off all five
                # Farmsteads at v22, and the 2-coin bar was restored at v24/v25.
                # Every starter row passes this check from v25 on.
                if cost["coins"] != 2 or cost["suit"] or cost["wild"]:
                    warnings.append(f"r{r} {ref}: starter upgrade cost is not exactly 2 coins ({dict(cost)})")
                cards[key] = {
                    "id": ref, "suit": suit, "type": "starter", "slot": slot,
                    "name": clean(name), "inDeck": False, "enabled": True,
                    "buildCost": None,
                    "upgradeCostCoins": 2,
                    "abilityTrigger": [], "needsDesignReview": False,
                }
            elif cost:
                warnings.append(f"r{r} {ref}: upgraded face has a printed cost ({dict(cost)}), expected none")
            continue

        if upgraded:
            warnings.append(f"r{r} {ref}: non-starter marked upgraded")
        text = clean(g("effect")) or clean(g("ability"))
        trigger, ambiguous = triggers_for(ctype, text, threshold, activation)
        cards[(suit, ref)] = {
            "id": ref, "suit": suit, "type": ctype, "name": clean(name), "inDeck": True,
            "enabled": True,
            "buildCost": {"suit": cost["suit"], "wild": cost["wild"], "coins": cost["coins"]},
            "activationType": activation, "threshold": threshold, "printedVp": vp,
            "abilityText": text, "abilityTrigger": trigger,
            "needsDesignReview": ambiguous,
        }

    for key, f in faces.items():
        if set(f) != {"starter", "upgraded"}:
            warnings.append(f"{key}: starter has faces {sorted(f)}, expected both")
            continue
        cards[key]["faces"] = f
        warnings += merge_starter_stats(cards[key], f)

    ordered = sorted(cards.values(), key=lambda c: (c["suit"], int(re.sub(r"\D", "", c["id"]))))

    # --- validation -------------------------------------------------------
    by_suit = collections.Counter(c["suit"] for c in ordered)
    by_type = collections.Counter((c["suit"], c["type"]) for c in ordered)
    expect = {"starter": 3, "tier1": 5, "tier2": 4, "tier3": 3, "power": 3, "endgame": 3}
    for suit in by_suit:
        for t, n in expect.items():
            if by_type[(suit, t)] != n:
                warnings.append(f"{suit}: expected {n} {t}, found {by_type[(suit, t)]}")
        deck = sum(1 for c in ordered if c["suit"] == suit and c["inDeck"])
        if deck != 18:
            warnings.append(f"{suit}: expected 18 shuffled deck cards, found {deck}")
    if len(ordered) != 105:
        warnings.append(f"expected 105 cards total (5 x (3 starters + 18 deck)), found {len(ordered)}")

    doc = {
        "meta": {
            "schemaVersion": 1,
            "kind": "generated",
            "generatedBy": "tools/extract_cards.py",
            "sourceSheet": "worksheet 'cards' of the designer spreadsheet (kept outside this repo)",
            "sourceSha256": digest,
            "notes": [
                "buildCost is derived from the @cost1..@cost6 icon columns, which are"
                " authoritative; the sheet's 'Build Cost' text column is lossy.",
                "A suit has THREE starters - Barn (ref 1), Farmstead (ref 2), Notice Board"
                " (ref 3) - plus the 18-card deck (refs 4..21). 105 cards total"
                " (15 starters + 90 deck).",
                "The only loadable starter is the Notice Board (threshold 5 / wild), which"
                " upgrades to 'Special Orders'. The Farmstead is a passive suit-power card"
                " (no threshold); the Barn prints an absolute hand size on each face"
                " (`handSize`).",
                "Each starter's base row carries a combined 'base\\nUpgrade:...' cell; the"
                " base face keeps the part before 'Upgrade', and the upgraded face is taken"
                " from the separate 'U' row (its own name, 2 VP, and full text).",
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
                " cards are re-read by hand when their handlers are written.",
                "The one STRUCTURAL trigger is `action`: a tier card with printed text but"
                " no threshold and no activation type can be neither grown nor sown, so its"
                " text fires as a MAIN ACTION instead - taken in place of Draw, Build, Grow,"
                " Harvest or Deliver. The sheet prints no prefix for it, which is why it is"
                " read off the shape of the card rather than off a keyword.",
                "The Deliver trigger has TWO keys: onDeliver ('When you Deliver...', fires on"
                " island claims and balloon moves) and onDeliverIsland ('When you Deliver to"
                " the island...', island claims only).",
            ],
        },
        "suits": sorted(by_suit),
        "catalogue": ordered,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    review = [c["id"] for c in ordered if c["needsDesignReview"]]
    shuffled = sum(c["inDeck"] for c in ordered)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(ordered)} cards "
          f"({shuffled} shuffled, {len(ordered) - shuffled} starters)")
    print(f"source sha256: {digest}")
    print(f"per suit: {dict(by_suit)}")
    print(f"ambiguous abilityTrigger ({len(review)}): {' '.join(review)}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  - {w}")
    return 1 if any(m in w for w in warnings for m in FATAL_MARKERS) else 0


if __name__ == "__main__":
    sys.exit(main())
