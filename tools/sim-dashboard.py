"""Build the simulation dashboard: one self-contained HTML page from watchlist reports.

    python tools/sim-dashboard.py                        # latest base watchlist + its noise floor
    python tools/sim-dashboard.py --before 2026-09-16    # latest base run before that date
    python tools/sim-dashboard.py --baseline reports/watchlist-...txt \
        --arms reports/<control>.txt reports/<arm>.txt ... --arms-noise reports/noise-...txt

The page is the same every time: header, what needs attention, the verdict, Dean's bands,
the series, suits, economy, seats and bots, the action mix, the cut list, and (with --arms)
a paired-arm table whose deltas are marked against the noise floor for THOSE arms' seeds.

The parser reads the report TEXT, so a report whose wording changes can lose a reading.
Nothing crashes on that: every reading that could not be found is listed on the page under
"Parse warnings", so a gap is visible rather than silent.

Output goes to reports/ (gitignored) as dashboard-<run stamp>-<reference>.html, and never
over an existing file: a second build of the same run is -v2, then -v3.
"""

from __future__ import annotations

import argparse
import codecs
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
TEMPLATE = Path(__file__).resolve().parent / "sim-dashboard-template.html"

SEATS = ("2p", "3p", "4p")

# A report is UTF-8 but can carry a stray single-byte pound sign; decode that byte as Latin-1.
codecs.register_error("latin1fallback", lambda e: (e.object[e.start:e.end].decode("latin-1"), e.end))
SUITS = ("wheat", "dairy", "vegetable", "apiary", "orchard")
NUM = r"-?[\d,]*\.?\d+"
STAMP_RE = re.compile(r"(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})")


def f(s):
    return None if s is None else float(str(s).replace(",", ""))


class Report:
    """One watchlist report, parsed into a plain dict."""

    def __init__(self, path: Path):
        self.path = path
        self.text = path.read_text(encoding="utf-8", errors="latin1fallback")
        self.lines = self.text.splitlines()
        self.warnings: list[str] = []

    # --- helpers -------------------------------------------------------------------------

    def find(self, pattern, where=None, flags=0, label=None):
        m = re.search(pattern, self.text if where is None else where, flags)
        if not m and label:
            self.warnings.append(label)
        return m

    def seat_triplet(self, pattern, where=None, label=None, pct=False):
        """Match '2p X ... 3p Y ... 4p Z' after `pattern` and return {2p,3p,4p}."""
        unit = "%" if pct else ""
        rx = pattern + rf".*?2p\s+({NUM}){unit}.*?3p\s+({NUM}){unit}.*?4p\s+({NUM}){unit}"
        m = self.find(rx, where, re.S, label)
        return {s: f(m.group(i + 1)) for i, s in enumerate(SEATS)} if m else None

    def section(self, *titles):
        """Text between a ruled section heading and the next one; the first title found wins."""
        for title in titles:
            m = re.search(rf"^{re.escape(title)}.*?$\n-+\n(.*?)(?=^-{{20,}}\n[A-Z]|\Z)", self.text, re.S | re.M)
            if m:
                return m.group(1)
        self.warnings.append(f"section '{titles[0]}' not found")
        return ""

    # --- parts ---------------------------------------------------------------------------

    def header(self):
        h = {"file": self.path.name}
        for key in ("seed", "data", "games", "mirrors", "wall", "engine", "hand limit"):
            m = re.search(rf"^{key}\s{{2,}}(.*)$", self.text, re.M)
            h[key.replace(" ", "_")] = m.group(1).strip() if m else None
        if h["data"]:
            parts = re.split(r"\s+overlay:\s*", h["data"])
            h["data"] = parts[0]
            h["overlay"] = parts[1] if len(parts) > 1 else None
        m = STAMP_RE.search(self.path.name)
        h["stamp"] = f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else None
        h["date"] = m.group(1) if m else None
        m = re.search(r"reference-v\d+(?:-(.+))?\.txt$", self.path.name)
        h["reference"] = h["seed"]
        h["arm"] = m.group(1) if m and m.group(1) else "base"
        m = re.search(r"^games\s+(\d+)", self.text, re.M)
        h["games_total"] = int(m.group(1)) if m else None
        m = re.search(r"wall\s+([\d.]+)s", self.text)
        h["wall_s"] = f(m.group(1)) if m else None
        return h

    def checks(self):
        out = []
        body = self.text.split("THE WATCH LIST", 1)[-1].split("\nVERDICT:", 1)[0]
        cur = None
        for line in body.splitlines():
            m = re.match(r"^\s?(\d+)\s+(PASS|FAIL|OBSERVE)\s+(.*)$", line)
            if m:
                title, _, summary = m.group(3).partition(" - ")
                cur = {"id": int(m.group(1)), "status": m.group(2), "title": title.strip(),
                       "summary": summary.strip(), "measured": None, "rule": None, "details": []}
                out.append(cur)
                continue
            if cur is None:
                continue
            m = re.match(r"^\s{5,}(measured|rule|detail|design|source|remedy|mirrors):\s*(.*)$", line)
            if m:
                key, val = m.group(1), m.group(2).strip()
                if key == "detail":
                    cur["details"].append(val)
                elif key in ("measured", "rule", "mirrors"):
                    cur[key] = val
        m = re.search(r"VERDICT:\s*(\d+) PASS, (\d+) FAIL, (\d+) OBSERVE", self.text)
        verdict = {"pass": int(m.group(1)), "fail": int(m.group(2)), "observe": int(m.group(3))} if m else None
        if not verdict:
            self.warnings.append("verdict line")
        return out, verdict

    def series(self):
        sec = self.section("THE SERIES")
        rows = {}
        for line in sec.splitlines():
            if len(line) < 40 or line.startswith(" ") or "seats" in line[:40]:
                continue
            label = line[:34].strip()
            cells = [line[34 + 20 * i:54 + 20 * i].strip() for i in range(3)]
            if not label or not all(cells):
                continue
            vals = []
            for c in cells:
                m = re.match(rf"({NUM})(%?)(?:\s*\[({NUM})%?\])?(?:\s+of\s+(\d+))?", c)
                vals.append({"v": f(m.group(1)), "all": f(m.group(3)), "of": f(m.group(4)),
                             "pct": bool(m.group(2))} if m else None)
            if all(vals):
                rows[label] = dict(zip(SEATS, vals))
        ends = {}
        for m in re.finditer(r"^\s+(\dp)\s+ended (\d+)(.*)$", sec, re.M):
            ends[m.group(1)] = {"ended": int(m.group(2)),
                                **{k: int(v) for k, v in re.findall(r"(\w+) (\d+)", m.group(3))}}
        vp = None
        m = re.search(r"island receipts (\d+)%\s+printed VP (\d+)%\s+endgame cards (\d+)%", sec)
        if m:
            vp = {"island": f(m.group(1)), "printed": f(m.group(2)), "endgame": f(m.group(3))}
        else:
            self.warnings.append("VP sources")
        return rows, ends, vp

    def kv_section(self, title):
        """'  label   value   (note)' lines, for the suit-rebuild and giveaway pages."""
        out = []
        for line in self.section(title).splitlines():
            m = re.match(rf"^\s{{2}}(\S.*?)\s{{2,}}({NUM}%?)\s*(?:\((.*)\))?\s*$", line)
            if m:
                out.append({"label": m.group(1).strip(), "value": m.group(2), "note": (m.group(3) or "").strip()})
        return out

    def by_suit_line(self, heading, where):
        m = re.search(re.escape(heading) + r"\s*\n\s+(.*)", where)
        if not m:
            self.warnings.append(heading)
            return None
        return {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})", m.group(1))}

    def sky(self):
        # "THE SKY" left the title when the balloons were deleted (16/09/2026).
        sec = self.section("THE SKY, THE MANIFEST AND THE RACE", "THE MANIFEST AND THE RACE")
        out = {}
        m = re.search(rf"balloon moves per game\s+({NUM})", sec)
        out["balloon_moves"] = f(m.group(1)) if m else None
        m = re.search(r"by BALLOON, of (\d+) moves:(.*)", sec)
        out["balloon_mix"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", m.group(2))} if m else None
        out["deliveries"] = self.by_suit_line("island deliveries per seat, by suit:", sec)
        out["barn_in"] = self.by_suit_line("cards into the barn per seat, by suit (all routes):", sec)
        out["buildings"] = self.by_suit_line("buildings built per seat, by suit:", sec)
        m = re.search(rf"first share ({NUM})%\s+first arrivals leaving the 6 VP space ({NUM})%", sec)
        out["first_share"] = f(m.group(1)) if m else None
        out["first_left_6"] = f(m.group(2)) if m else None
        m = re.search(rf"demand tokens altered per game\s+({NUM})", sec)
        out["demand_tokens"] = f(m.group(1)) if m else None
        if out["first_share"] is None:
            m = re.search(rf"first share ({NUM})%", sec)
            out["first_share"] = f(m.group(1)) if m else None
        # The token island (16/09/2026).
        m = re.search(rf"island tokens swapped per game[^\n]*?\s{{2,}}({NUM})", sec)
        out["tokens_swapped"] = f(m.group(1)) if m else None
        m = re.search(rf"first-delivery token choices\s+(\d+)\s+took the higher VP ({NUM})%\s+lower for a Worker (\d+)", sec)
        out["token_choice"] = {"choices": f(m.group(1)), "higher": f(m.group(2)), "lower_for_worker": f(m.group(3))} if m else None
        m = re.search(r"receipts by token value\s+(.*)", sec)
        out["token_values"] = {f"{v} VP": f(n) for v, n in re.findall(r"(\d+) VP (\d+)", m.group(1))} if m else None
        w = re.search(r"wild-token receipts (\d+)", m.group(1)) if m else None
        out["wild_receipts"] = f(w.group(1)) if w else None
        m = re.search(r"Vegetable board relaxation[^\n]*?(\d+) deliveries, (\d+) cards of any crop", sec)
        out["veg_relax"] = {"deliveries": f(m.group(1)), "cards": f(m.group(2))} if m else None
        return out

    def barn_routes(self):
        sec = self.section("THE GIVEAWAY, THE BARN AND THE GROVE")
        m = re.search(r"by route.*?\n\s+(.*)", sec)
        return {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})", m.group(1))} if m else None

    def worker_use(self):
        """THE WORKERS (added 2026-09-20): each colour's share spent against its own mint,
        ranked most popular first, plus the same share broken out by seat count.

        Older reports have no such section - `self.section` already warns once and hands
        back "" in that case, so this parses to empty and does not warn a second time."""
        sec = self.section("THE WORKERS")
        rows = []
        started = False
        for line in sec.splitlines():
            if line.startswith("colour"):
                started = True
                continue
            if not started:
                continue
            if not line.strip():
                break
            parts = re.split(r"\s{2,}", line.strip())
            if len(parts) >= 6:
                rows.append({
                    "colour": parts[0], "buys": parts[1], "earned": f(parts[2]),
                    "spent": f(parts[3]), "never_used": f(parts[4]), "share": f(parts[5].rstrip("%")),
                })
        by_seat = {}
        for suit in SUITS:
            m = re.search(rf"^\s+{suit}\s+2p\s+({NUM})%\s+3p\s+({NUM})%\s+4p\s+({NUM})%", sec, re.M)
            if m:
                by_seat[suit] = {s: f(m.group(i + 1)) for i, s in enumerate(SEATS)}
        if sec and not rows:
            self.warnings.append("THE WORKERS table rows")
        elif rows and len(by_seat) < len(rows):
            self.warnings.append("THE WORKERS by-seat breakdown")
        return {"rows": rows, "by_seat": by_seat}

    def table(self, title, header_word, cols):
        """A whitespace table under a section heading, first column a label."""
        rows = []
        started = False
        for line in self.section(title).splitlines():
            if line.startswith(header_word):
                started = True
                continue
            if not started:
                continue
            if not line.strip():
                if rows and title != "SEATS":
                    break
                continue
            parts = re.split(r"\s{2,}", line.strip())
            if len(parts) >= len(cols):
                rows.append(dict(zip(cols, parts)))
        return rows

    def cut_list(self):
        sec = self.section("THE CUT LIST")
        bottom, top, target = [], [], None
        for line in sec.splitlines():
            if line.startswith("card "):
                target = bottom
                continue
            if line.startswith("Top of the table"):
                target = top
                continue
            m = re.match(r"^([A-Z]\d+)\s+(.{23})\s*(\S+)\s+(\d+)%\s+([-+]\d+)%\s+(\d+/\d+)\s+(\d+)\s*(.*)$", line)
            if target is not None and m:
                target.append({"card": m.group(1), "name": m.group(2).strip(), "band": m.group(3),
                               "play": f(m.group(4)), "vs": f(m.group(5)), "rank": m.group(6),
                               "diff": int(m.group(7)), "flags": m.group(8).strip()})
        return {"bottom": bottom, "top": top}

    # --- the readings the dashboard leads with ------------------------------------------

    def readings(self, checks):
        c = {k["id"]: k for k in checks}
        retired = {int(x) for x in re.findall(r"^\s+(\d+) .*? - retired ", self.text, re.M)}

        def blob(i):
            k = c.get(i)
            if not k:
                if i not in retired:
                    self.warnings.append(f"check a{i:02d} missing")
                return ""
            return "\n".join([k["title"], k["summary"], k["measured"] or "", *k["details"]])

        r = {}
        b17 = blob(17)
        m = self.find(rf"used on ({NUM})% of (\d+) turns", b17, label="a17 slot share")
        r["slot_turns"] = f(m.group(1)) if m else None
        m = self.find(rf"plays per turn ({NUM})%", b17, label="a17 plays per turn")
        r["plays_turn"] = f(m.group(1)) if m else None
        m = self.find(rf"2p ({NUM})% \(({NUM})%\) of \d+ turns\s+3p ({NUM})% \(({NUM})%\) of \d+ turns\s+4p ({NUM})% \(({NUM})%\)",
                      b17, label="a17 by seat count")
        if m:
            g = [f(x) for x in m.groups()]
            r["slot_turns_seat"] = dict(zip(SEATS, g[0::2]))
            r["plays_turn_seat"] = dict(zip(SEATS, g[1::2]))
        r["slot_unspent_seat"] = self.seat_triplet(r"slot unspent by seat count:", b17, pct=True)

        b8 = blob(8)
        m = self.find(rf"({NUM}) NEIGHBOUR visits per player per turn", b8, label="a08 hook")
        r["hook"] = f(m.group(1)) if m else None
        r["hook_seat"] = self.seat_triplet(r"neighbour visits per turn by seat count:", b17, label="hook by seat count")
        m = re.search(rf"CROSS-TABLE SHARE OF EVERY PLAY ({NUM})%", b8)
        r["cross_table"] = f(m.group(1)) if m else None

        b16 = blob(16)
        m = self.find(rf"({NUM}) actions resolved per player per turn", b16, label="a16 actions")
        r["actions"] = f(m.group(1)) if m else None

        r["clog_seat"] = self.seat_triplet(r"Clog as denial", blob(5), pct=True, label="a05 by seat count")

        b6 = blob(6)
        m = self.find(rf"median barn ({NUM}) in the middle third, ({NUM}) in the last", b6, label="a06 barn glut")
        r["glut"] = {"middle": f(m.group(1)), "last": f(m.group(2))} if m else None
        m = self.find(rf"2p ({NUM}) -> ({NUM})\s+3p ({NUM}) -> ({NUM})\s+4p ({NUM}) -> ({NUM})", b6, label="a06 by seat count")
        if m:
            g = [f(x) for x in m.groups()]
            r["glut_seat"] = {s: {"middle": g[2 * i], "last": g[2 * i + 1]} for i, s in enumerate(SEATS)}

        b7 = blob(7)
        m = self.find(r"all colours:(.*)", b7, label="a07 door mix")
        r["doors"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", m.group(1))} if m else None
        m = re.search(rf"takes ({NUM})% of (\d+) door uses", b7)
        r["top_door"] = f(m.group(1)) if m else None
        m = re.search(rf"door uses per ended game: ({NUM})", b7)
        r["door_uses_game"] = f(m.group(1)) if m else None

        b2 = blob(2)
        m = self.find(rf"({NUM}) fees a game land on a rival's board, ({NUM})% of them reach the host's barn", b2, label="a02 fees")
        r["fees_game"], r["fees_banked"] = (f(m.group(1)), f(m.group(2))) if m else (None, None)
        m = re.search(rf"({NUM})% of fees went to the seat that was already the sole VP leader", b2)
        r["fees_to_leader"] = f(m.group(1)) if m else None

        b11 = blob(11)
        m = self.find(rf"({NUM})% of \d+ Dairy turns began with no legal Build \(the other suits: ({NUM})%", b11, label="a11 dairy")
        r["dairy_nobuild"], r["other_nobuild"] = (f(m.group(1)), f(m.group(2))) if m else (None, None)

        b12 = blob(12)
        m = re.search(rf"({NUM}) raids per game.*?score ({NUM}) against ({NUM})", b12)
        r["raids"] = {"per_game": f(m.group(1)), "raided": f(m.group(2)), "others": f(m.group(3))} if m else None

        r["locked_seat"] = self.seat_triplet(r"measured:", "measured:" + (c.get(13, {}).get("measured") or ""), pct=True)

        m = re.search(rf"({NUM})% of meeples gained are spent", blob(15))
        r["meeple_spend_rate"] = f(m.group(1)) if m else None

        b18 = blob(18)
        m = self.find(rf"({NUM})% of barn cards arrived as somebody else's fee", b18, label="a18 fee share")
        r["fee_share"] = f(m.group(1)) if m else None
        m = self.find(rf"busiest board ({NUM})% of its game's placements against an even ({NUM})%", b18, label="a18 busiest board")
        r["busiest_board"], r["busiest_even"] = (f(m.group(1)), f(m.group(2))) if m else (None, None)
        m = self.find(rf"YOUR OWN FARM ({NUM})%.*?FEE OFF YOUR OWN NOTICE BOARD ({NUM})%", b18, label="a18 farm bypass")
        r["harvest_own"], r["harvest_fee"] = (f(m.group(1)), f(m.group(2))) if m else (None, None)
        m = re.search(rf"farm / fee / centre: 2p ({NUM})% / ({NUM})% / {NUM}%\s+3p ({NUM})% / ({NUM})% / {NUM}%\s+4p ({NUM})% / ({NUM})%", b18)
        if m:
            g = [f(x) for x in m.groups()]
            r["harvest_seat"] = {s: {"own": g[2 * i], "fee": g[2 * i + 1]} for i, s in enumerate(SEATS)}
        r["visits_received_seat"] = self.seat_triplet(r"VISITS RECEIVED PER PLAYER PER GAME:.*?By seat count:", b18)

        b20 = blob(20)
        m = re.search(rf"({NUM})% of \d+ BOARD-TURNS", b20)
        r["stall"] = f(m.group(1)) if m else None
        r["stall_seat"] = self.seat_triplet(r"THE STALL SHARE:.*?BY SEAT COUNT", b20, pct=True)

        b21 = blob(21)
        m = re.search(rf"mean hand at the start of a turn ({NUM})", b21)
        r["hand_mean"] = f(m.group(1)) if m else None
        r["hand_mean_seat"] = self.seat_triplet(r"By seat count \(mean hand", b21)
        r["hand_bound_seat"] = self.seat_triplet(r"turns began AT the bound\. By seat count:", b21, pct=True)

        b22 = blob(22)
        m = self.find(r"island receipt VP a player a game (.*?)\. HAND", b22, label="a22 receipt VP by crop")
        r["receipt_vp"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})", m.group(1))} if m else None
        m = re.search(r"mean (apiary.*?), empty-handed turns (.*?%)(?:\s|$)", b22)
        if m:
            r["hand_crop"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})", m.group(1))}
            r["empty_crop"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", b22[m.start(2):m.start(2) + 160])}
        m = re.search(rf"share of turns that began AT the bound: (apiary.*?wheat {NUM}%)", b22)
        r["bound_crop"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", m.group(1))} if m else None

        b23 = blob(23)
        m = self.find(rf"({NUM}) MINTED, ({NUM}) SPENT and ({NUM}) STRANDED.*?({NUM})% of every meeple minted", b23, re.S, label="a23 meeple")
        if m:
            r["meeple"] = {"minted": f(m.group(1)), "spent": f(m.group(2)), "stranded": f(m.group(3)), "stranded_share": f(m.group(4))}
        seat = {}
        for key in ("Minted", "Spent", "Stranded"):
            seat[key.lower()] = self.seat_triplet(rf"BY SEAT COUNT, per player per game\..*?{key}:", b23)
        seat["stranded_share"] = self.seat_triplet(r"Stranded share:", b23, pct=True)
        r["meeple_seat"] = seat
        m = re.search(r"Spent mix (.*?);", b23)
        r["meeple_spent_mix"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", m.group(1))} if m else None
        m = re.search(rf"stranded mix (apiary.*?wheat {NUM}%)", b23)
        r["meeple_stranded_mix"] = {k: f(v) for k, v in re.findall(rf"(\w+) ({NUM})%", m.group(1))} if m else None
        m = re.search(rf"({NUM})% took the 3 VP space", b23)
        r["space_choice_3vp"] = f(m.group(1)) if m else None
        m = re.search(rf"({NUM}) tiles CLOSED and ({NUM}) cards drawn", b23)
        r["closing"] = {"tiles": f(m.group(1)), "cards": f(m.group(2))} if m else None
        r["closing_cards_seat"] = self.seat_triplet(r"cards drawn for closing them.*?cards:", b23)

        b24 = blob(24)
        m = re.search(rf"({NUM}) cards a player a game were still in a barn", b24)
        r["barn_stranded"] = f(m.group(1)) if m else None
        m = re.search(rf"({NUM}) reshuffles per played deck", b24)
        r["reshuffles"] = f(m.group(1)) if m else None

        b25 = blob(25)
        m = re.search(rf"({NUM}) coins minted per player per game \(({NUM}) a delivery\)", b25)
        m2 = re.search(rf"held NOTHING on ({NUM})% of turns; spent ({NUM})% on builds and ({NUM})% on Grows, of which (\d+) fired on a FULL", b25)
        m3 = re.search(rf"({NUM}) dead in a wallet", b25)
        if m and m2 and m3:
            r["coins"] = {"minted": f(m.group(1)), "per_delivery": f(m.group(2)), "supply_empty": f(m2.group(1)),
                          "on_builds": f(m2.group(2)), "on_grows": f(m2.group(3)), "full_grows": f(m2.group(4)),
                          "dead": f(m3.group(1))}
        elif 25 in c:
            self.warnings.append("a25 Store coin")

        b26 = blob(26)
        m = re.search(rf"({NUM})% of \d+ exchange windows converted at all, ({NUM})% of the.*?({NUM})% of windows took EVERY", b26)
        r["c113"] = {"any": f(m.group(1)), "cards": f(m.group(2)), "all": f(m.group(3))} if m else None

        b27 = blob(27)
        m = self.find(rf"mean ({NUM}) cards at the start of a turn, PEAK (\d+), and ({NUM})% of turns began already at the engine.s bound of (\d+); the worst end-of-turn discard enumeration offered (\d+) legal moves",
                      b27, label="a27 hand and branching")
        if m:
            r["hand"] = {"mean": f(m.group(1)), "peak": f(m.group(2)), "at_bound": f(m.group(3)),
                         "bound": f(m.group(4)), "worst_moves": f(m.group(5))}
        return r

    def parse(self):
        checks, verdict = self.checks()
        series, ends, vp = self.series()
        data = {
            "header": self.header(),
            "verdict": verdict,
            "checks": checks,
            "retired": re.findall(r"^\s+(\d+) (.*?) - retired (.*)$", self.text, re.M),
            "series": series,
            "end_reasons": ends,
            "vp_sources": vp,
            "barn_routes": self.barn_routes(),
            "giveaway": self.kv_section("THE GIVEAWAY, THE BARN AND THE GROVE"),
            "sky": self.sky(),
            "yard": self.kv_section("THE YARD"),
            "swarm": self.kv_section("THE SWARM"),
            "worker_use": self.worker_use(),
            "action_mix": self.table("THE ACTION MIX", "move", ["move", "taken", "offered", "rate", "per_game"]),
            "seats": self.table("SEATS", "seats", ["seats", "seat", "games", "win", "dev", "ci", "score", "receipts", "turns"]),
            "suits": self.table("SUITS", "suit", ["suit", "seat_games", "win", "ci"]),
            "bots": self.table("BOTS", "profile", ["profile", "seat_games", "win", "ci"]),
            "cut_list": self.cut_list(),
        }
        data["readings"] = self.readings(checks)
        m = re.search(rf"seat deviation \+/-({NUM})", self.text)
        data["seat_noise_quoted"] = f(m.group(1)) if m else None
        data["warnings"] = self.warnings
        return data


def parse_noise(path: Path | None):
    if not path:
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"movement:\s*\{(.*?)\}", text, re.S)
    ref = re.search(r"^reference\s+(\S+)", text, re.M)
    measured = re.search(r"measured:\s*'([^']+)'", text)
    return {
        "file": path.name,
        "reference": ref.group(1) if ref else None,
        "measured": measured.group(1) if measured else None,
        "movement": {k: float(v) for k, v in re.findall(rf'"(.+?)":\s*({NUM})', m.group(1))} if m else {},
    }


def stamp_of(p: Path):
    m = STAMP_RE.search(p.name)
    return m.group(0) if m else ""


def latest_base(before: str | None):
    runs = [p for p in REPORTS.glob("watchlist-*-reference-v*.txt") if re.search(r"reference-v\d+\.txt$", p.name)]
    if before:
        runs = [p for p in runs if stamp_of(p)[:10] < before]
    if not runs:
        sys.exit("no base watchlist report found")
    return max(runs, key=stamp_of)


def latest_noise(reference: str, before: str | None):
    runs = [p for p in REPORTS.glob(f"noise-*-{reference}.txt")]
    if before:
        runs = [p for p in runs if stamp_of(p)[:10] < before]
    return max(runs, key=stamp_of) if runs else None


def versioned(path: Path):
    if not path.exists():
        return path
    n = 2
    while True:
        cand = path.with_name(f"{path.stem}-v{n}{path.suffix}")
        if not cand.exists():
            return cand
        n += 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", type=Path, help="watchlist report to lead with (default: latest base run)")
    ap.add_argument("--before", help="YYYY-MM-DD: pick the latest base run dated before this day")
    ap.add_argument("--noise", type=Path, help="noise report for the baseline (default: latest for its reference)")
    ap.add_argument("--arms", type=Path, nargs="+", help="paired arms on identical seeds; the FIRST is the control")
    ap.add_argument("--arms-noise", type=Path, help="noise report for the arms' reference (default: latest for it)")
    ap.add_argument("--json", type=Path, help="also write the parsed data here")
    ap.add_argument("--out", type=Path, help="output HTML (never overwritten; a -vN suffix is added)")
    a = ap.parse_args()

    base_path = a.baseline or latest_base(a.before)
    base = Report(base_path).parse()
    ref = base["header"]["reference"]
    noise_path = a.noise or latest_noise(ref, a.before)
    data = {"built": date.today().isoformat(), "baseline": base, "noise": parse_noise(noise_path), "arms": None}
    if not noise_path:
        base["warnings"].append(f"no noise report for {ref}")

    if a.arms:
        arms = [Report(p).parse() for p in a.arms]
        arm_ref = arms[0]["header"]["reference"]
        mixed = sorted({x["header"]["reference"] for x in arms})
        arm_noise = a.arms_noise or latest_noise(arm_ref, a.before)
        data["arms"] = {"reference": arm_ref, "mixed_references": mixed if len(mixed) > 1 else None,
                        "runs": arms, "noise": parse_noise(arm_noise)}

    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__DATA__*/null", payload)
    stamp = stamp_of(base_path) or "run"
    out = versioned(a.out or REPORTS / f"dashboard-{stamp}-{ref}.html")
    out.write_text(html, encoding="utf-8", newline="\n")
    if a.json:
        versioned(a.json).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")

    print(f"baseline  {base_path.name}")
    print(f"noise     {noise_path.name if noise_path else 'none'}")
    if a.arms:
        print(f"arms      {len(a.arms)} on {data['arms']['reference']}, control {a.arms[0].name}")
    warns = base["warnings"] + [w for r in (data["arms"] or {}).get("runs", []) for w in r["warnings"]]
    print(f"warnings  {len(warns)}" + ("".join(f"\n  - {w}" for w in warns)))
    print(f"wrote     {out}")


if __name__ == "__main__":
    main()
