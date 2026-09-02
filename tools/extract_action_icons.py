# -*- coding: utf-8 -*-
"""Cut the six action icons out of the player aid into standalone assets.

Run:  python tools/extract_action_icons.py
  or:  python tools/extract_action_icons.py --check   (verify, write nothing)

    source  packages/ui/public/art/frame/player_aid_actions.webp   (369x512)
    output  packages/ui/public/art/actions/{draw,build,grow,harvest,deliver,visit}.webp

WHY A SCRIPT AND NOT SIX COMMITTED FILES
----------------------------------------
The player aid is a GENERATED asset. It comes out of the game's art pipeline and
is regenerated whenever the action wording changes - and the wording has changed
repeatedly (FARM became GROW, the bonus slot was re-cut on 19/08/2026). Six
hand-cropped PNGs would silently go stale the first time the aid was re-rendered
and nobody would notice until the icons disagreed with the rules text beside
them. Re-running this is the whole maintenance story: regenerate the aid, run
this, look at the six files.

The trade-off is that the crop boxes below are coordinates into an image this
script does not control. That is the failure mode to watch, and `--check` is the
cheap guard against it: it re-measures the source's dimensions and refuses to cut
if the aid is no longer 369x512, because at any other size the boxes are cutting
the wrong pixels rather than failing loudly.

THE CROP BOXES
--------------
Found by scanning the aid for its tile boundaries, not by eye. The aid lays out
six rows down its left column, each a rounded vignette in the locked art style
(warm sepia line work, kawaii proportions, gouache wash); the boxes are the
painted area inside each tile's frame.

    action    (left, top, right, bottom)   tile
    draw      (12,  76, 68, 132)           "Draw 2, Discard 1"
    build     (12, 147, 68, 203)           "Build"
    grow      (12, 216, 68, 272)           "Grow"
    harvest   (12, 285, 68, 341)           "Harvest"
    deliver   (12, 354, 68, 410)           "Deliver"
    visit     (12, 438, 68, 494)           the ALSO strip - visit / hire

The first five sit on a regular 69px pitch. Visit does NOT: it lives in the
aid's dark ALSO strip at the foot, which is a different band with its own
padding, so its box is 84px below Deliver rather than 69. Do not "tidy" the
table into a computed pitch - the sixth row would land on the strip's border.

⚠️ THESE ARE UPSCALED FROM A SMALL SOURCE AND WILL BE SOFT AT LARGE SIZES.
Each tile is 56x56 real pixels. The output is 128px square, which is a 2.3x
enlargement, so nothing here can be sharper than a 56px painting - it is fine at
the 18-30px the turn bar draws it at and visibly soft if anything ever prints it
bigger. LANCZOS is the best of the available filters for this (a windowed sinc,
so it keeps the sepia outlines crisp where a bilinear resize smears them), but a
better filter cannot invent detail that was never painted. Dean has been told;
proper icons drawn at size may be commissioned later, and when they are, the
replacement is to drop them into `public/art/actions/` and delete this script -
`actionIcon()` in `view/art.ts` is the only thing that names the path.

WHY WEBP AND WHY LOSSLESS
-------------------------
WebP because every other asset in `public/art/` is WebP and `actionIcon()` builds
the path by convention. Lossless because these are tiny (a few KB each) and lossy
compression at 128px on an already-upscaled image adds ringing round exactly the
sepia outlines the art style is built on. There is no size argument to be had at
this scale.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

# The aid this script cuts, and the size those boxes were measured against. A
# regenerated aid at a different size is a hard stop, not a warning: see the
# module docstring.
SOURCE = Path("packages/ui/public/art/frame/player_aid_actions.webp")
SOURCE_SIZE = (369, 512)
OUT_DIR = Path("packages/ui/public/art/actions")

# The output edge, in pixels. 128 is roughly 4x the largest size the turn bar
# draws an icon at (30px at the 3840 step), which is the headroom a 2x display
# needs plus a little. Bigger buys nothing: the source is 56px.
OUT_EDGE = 128

# (left, top, right, bottom), in the source's own pixels. See the docstring for
# where these came from and why `visit` breaks the pitch.
BOXES = {
    "draw": (12, 76, 68, 132),
    "build": (12, 147, 68, 203),
    "grow": (12, 216, 68, 272),
    "harvest": (12, 285, 68, 341),
    "deliver": (12, 354, 68, 410),
    "visit": (12, 438, 68, 494),
}


def repo_root() -> Path:
    """The repo root, derived from this file rather than from the cwd.

    Same reason `extract_cards.py` takes an explicit path: a script that only
    works when it is run from one directory is a script somebody will run from
    the wrong one.
    """
    return Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the source and the boxes, write nothing",
    )
    args = parser.parse_args()

    root = repo_root()
    source = root / SOURCE
    if not source.exists():
        print(f"missing source: {source}", file=sys.stderr)
        return 1

    aid = Image.open(source).convert("RGB")
    if aid.size != SOURCE_SIZE:
        print(
            f"the aid is {aid.size}, not {SOURCE_SIZE}. The crop boxes were "
            f"measured against {SOURCE_SIZE} and would cut the wrong pixels at "
            f"any other size - re-measure the tile boundaries and update BOXES.",
            file=sys.stderr,
        )
        return 1

    out_dir = root / OUT_DIR
    if not args.check:
        out_dir.mkdir(parents=True, exist_ok=True)

    for name, box in BOXES.items():
        left, top, right, bottom = box
        if right > aid.width or bottom > aid.height:
            print(f"{name}: box {box} falls outside the aid", file=sys.stderr)
            return 1
        tile = aid.crop(box)
        icon = tile.resize((OUT_EDGE, OUT_EDGE), Image.LANCZOS)
        target = out_dir / f"{name}.webp"
        if args.check:
            print(f"  ok  {name:8} {tile.size} -> {icon.size}  ({target.name})")
            continue
        icon.save(target, "WEBP", lossless=True, quality=100, method=6)
        print(f"  wrote {target.relative_to(root)}  {icon.size}  {target.stat().st_size}B")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
