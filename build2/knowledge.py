#!/usr/bin/env python3
"""Treatment Knowledge Base (knowledge/treatments.json): check it and hand the app a resolved copy (data.json meta.kb).

usage: python build2/knowledge.py            # check, print review status counts (exit 1 on errors)
       python build2/knowledge.py --families # also list compare families that have no entry yet

An entry may name a `base` entry; fields it leaves out come from the base, and extra_side_effects / extra_cautions /
sources are added to the base's. Rules checked here:
  - ids unique, bases exist, every source id exists, review.status is one of `statuses`
  - after inheritance every entry has title, one_liner, purpose
  - an 'approved' entry needs review.reviewer, review.reviewed_at and at least one source
Entries without sources are allowed (shown as '근거 자료 미정리' with their evidence_note) but counted.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "knowledge", "treatments.json")
FIELDS = ["one_liner", "purpose", "areas", "method", "kinds", "evidence_note"]


def load(path=PATH):
    return json.load(open(path, encoding="utf-8"))


def resolve(kb):
    """→ (entries with inherited fields and resolved sources, errors)"""
    errors = []
    by = {}
    for x in kb["entries"]:
        if x["id"] in by:
            errors.append(f"id 중복: {x['id']}")
        by[x["id"]] = x
    out = []
    for x in kb["entries"]:
        b = by.get(x.get("base")) if x.get("base") else None
        if x.get("base") and not b:
            errors.append(f"{x['id']}: base '{x['base']}' 없음")
        r = {"id": x["id"], "title": x["title"], "families": x.get("families", []), "fids": x.get("fids", []), "base": x.get("base") or ""}
        for f in FIELDS:
            r[f] = x.get(f) if x.get(f) not in (None, "") else (b.get(f, "") if b else "")
        r["side_effects"] = (x.get("side_effects") or (b.get("side_effects", []) if b else [])) + x.get("extra_side_effects", [])
        r["cautions"] = (x.get("cautions") or (b.get("cautions", []) if b else [])) + x.get("extra_cautions", [])
        sids = list(dict.fromkeys((b.get("sources", []) if b else []) + x.get("sources", [])))
        for s in sids:
            if s not in kb["sources"]:
                errors.append(f"{x['id']}: 출처 '{s}' 없음")
        r["sources"] = [dict(kb["sources"][s], id=s) for s in sids if s in kb["sources"]]
        rv = x.get("review", {})
        if rv.get("status") not in kb["statuses"]:
            errors.append(f"{x['id']}: 검수 상태 '{rv.get('status')}'는 {list(kb['statuses'])} 중 하나여야 해요")
        if rv.get("status") == "approved" and not (rv.get("reviewer") and rv.get("reviewed_at") and r["sources"]):
            errors.append(f"{x['id']}: 검수 완료(approved)에는 검수자·검수일·출처가 필요해요")
        r["review"] = {k: rv.get(k, "") for k in ("status", "reviewer", "reviewed_at", "notes")}
        r["updated"] = x.get("updated", "")
        for f in ("title", "one_liner", "purpose"):
            if not r.get(f):
                errors.append(f"{x['id']}: '{f}'가 비어 있어요")
        out.append(r)
    return out, errors


def export():
    """what the app gets (data.json meta.kb): resolved entries + status names"""
    kb = load()
    entries, errors = resolve(kb)
    if errors:
        raise SystemExit("knowledge/treatments.json 오류:\n  " + "\n  ".join(errors))
    return {"updated": kb.get("updated", ""), "statuses": kb["statuses"], "entries": entries}


if __name__ == "__main__":
    kb = load()
    entries, errors = resolve(kb)
    from collections import Counter
    st = Counter(e["review"]["status"] for e in entries)
    print(f"entries {len(entries)} · 검수 상태 " + ", ".join(f"{kb['statuses'][k]} {v}" for k, v in st.items()))
    print(f"근거 출처가 있는 항목 {sum(1 for e in entries if e['sources'])} · 출처 없음(근거 자료 미정리) {sum(1 for e in entries if not e['sources'])}")
    if "--families" in sys.argv:
        vp = os.path.join(ROOT, "data2", "variants.json")
        if os.path.exists(vp):
            fams = json.load(open(vp, encoding="utf-8"))["families"]
            named = {f for e in entries for f in e["families"]}
            fids = {f for e in entries for f in e["fids"]}
            miss = sorted({(f["cat"], f["name"]) for f in fams if f["name"] not in named and f.get("fam") not in fids})
            print(f"설명 항목이 없는 제품군 {len(miss)}개:", ", ".join(f"{c}/{n}" for c, n in miss[:80]))
    if errors:
        print("오류:", *errors, sep="\n  ")
        raise SystemExit(1)
    print("tests ok")
