"""Map the internal call graph of a big TS file, section by section.

For each '// --- Name ---' banner section, find which top-level symbols defined
in OTHER sections it references. That is the edge set a split has to honour, and
it says which boundaries are clean and which would create an import cycle.
"""

import re
import sys
import pathlib
from collections import defaultdict

path = pathlib.Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
lines = src.split("\n")

# --- section boundaries
bounds = [(n, re.sub(r"^// --- | -*$", "", ln).strip())
          for n, ln in enumerate(lines) if ln.startswith("// --- ")]
bounds.insert(0, (0, "(header)"))
sections = []
for i, (n, name) in enumerate(bounds):
    end = bounds[i + 1][0] if i + 1 < len(bounds) else len(lines)
    sections.append((name, n, end))

# --- top-level declarations, and which section each belongs to
DECL = re.compile(
    r"^(?:export\s+)?(?:declare\s+)?"
    r"(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)"
)
owner, decls = {}, defaultdict(list)
for name, start, end in sections:
    for n in range(start, end):
        m = DECL.match(lines[n])
        if m:
            owner[m.group(1)] = name
            decls[name].append(m.group(1))

# --- references out of each section
def code_only(text: str) -> str:
    """Strip comments: a symbol NAMED in prose is not a dependency."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)//.*$", "", text)


edges = defaultdict(lambda: defaultdict(set))
for name, start, end in sections:
    body = code_only("\n".join(lines[start:end]))
    for tok in set(re.findall(r"\b[A-Za-z_$][\w$]*\b", body)):
        home = owner.get(tok)
        if home and home != name:
            edges[name][home].add(tok)

print(f"{path.name}: {len(lines)} lines, {len(sections)} sections, {len(owner)} top-level decls\n")
for name, start, end in sections:
    print(f"{name}  [{start + 1}-{end}]  {end - start} lines, {len(decls[name])} decls")
    for tgt, toks in sorted(edges[name].items(), key=lambda x: -len(x[1])):
        s = ", ".join(sorted(toks)[:6]) + (" ..." if len(toks) > 6 else "")
        print(f"      -> {tgt:52} {len(toks):3}  {s}")
    print()

# --- cycles between sections
print("=== two-way section pairs (would be an import cycle) ===")
seen = set()
for a in edges:
    for b in edges[a]:
        if a in edges.get(b, {}) and (b, a) not in seen:
            seen.add((a, b))
            print(f"  {a}  <->  {b}   ({len(edges[a][b])} / {len(edges[b][a])} symbols)")
if not seen:
    print("  none")
