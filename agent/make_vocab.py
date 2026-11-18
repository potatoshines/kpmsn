"""Writes agent/vocabulary.json (the closed tag list) from the catalog CSV. Run before deploying."""
import csv, json, re, pathlib
src = pathlib.Path(__file__).parent.parent / "src/data/kp_resource_opportunity_catalog.csv"
norm = lambda t: re.sub(r"[\s-]+", "_", t.strip().lower())
tags = set()
with open(src, newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        tags |= {norm(t) for t in re.split(r"[,;|]", row.get("matching_tags") or "") if t.strip()}
out = pathlib.Path(__file__).parent / "vocabulary.json"
out.write_text(json.dumps(sorted(tags), indent=1))
print(f"{len(tags)} tags -> {out}")
