"""Which section cycles are real? A type-only edge is erased by tsc, so it is free.

Splits the symbols into TYPES (interface/type) and VALUES (function/const/class).
A two-way pair is only a runtime cycle if BOTH directions carry a value.
"""

import re
import sys
import pathlib
from collections import defaultdict

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").split("\n")

bounds = [(n, re.sub(r"^// --- | -*$", "", ln).strip())
          for n, ln in enumerate(lines) if ln.startswith("// --- ")]
bounds.insert(0, (0, "(header)"))
sections = []
for i, (n, name) in enumerate(bounds):
    end = bounds[i + 1][0] if i + 1 < len(bounds) else len(lines)
    sections.append((name, n, end))

DECL = re.compile(
    r"^(?:export\s+)?(?:declare\s+)?"
    r"(?:async\s+)?(?P<kind>function|const|let|class|interface|type|enum)\s+(?P<id>[A-Za-z_$][\w$]*)"
)
TYPE_KINDS = {"interface", "type"}
owner, kind_of = {}, {}
for name, start, end in sections:
    for n in range(start, end):
        m = DECL.match(lines[n])
        if m:
            owner[m.group("id")] = name
            kind_of[m.group("id")] = m.group("kind")

def code_only(text: str) -> str:
    """Strip comments. A symbol NAMED in prose is not a dependency, and this file
    is two thirds prose - counting it reported a cycle that did not exist."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)//.*$", "", text)


edges = defaultdict(lambda: defaultdict(set))
for name, start, end in sections:
    body = code_only("\n".join(lines[start:end]))
    for tok in set(re.findall(r"\b[A-Za-z_$][\w$]*\b", body)):
        home = owner.get(tok)
        if home and home != name:
            edges[name][home].add(tok)


def values(toks):
    return {t for t in toks if kind_of.get(t) not in TYPE_KINDS}


real, free = [], []
seen = set()
for a in edges:
    for b in edges[a]:
        if a in edges.get(b, {}) and (b, a) not in seen:
            seen.add((a, b))
            va, vb = values(edges[a][b]), values(edges[b][a])
            (real if (va and vb) else free).append((a, b, va, vb))

short = lambda s: s.split(" (")[0][:44]
print(f"=== REAL runtime cycles: {len(real)} ===")
for a, b, va, vb in real:
    print(f"  {short(a):46} <-> {short(b)}")
    print(f"      {short(a)} needs: {', '.join(sorted(va))}")
    print(f"      {short(b)} needs: {', '.join(sorted(vb))}")
print(f"\n=== type-only pairs (free, erased by tsc): {len(free)} ===")
for a, b, va, vb in free:
    print(f"  {short(a):46} <-> {short(b)}")
