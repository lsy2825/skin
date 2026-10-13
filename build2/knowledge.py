#!/usr/bin/env python3
"""Treatment Knowledge Base (knowledge/treatments.json) and concern taxonomy (knowledge/concerns.json): check them and
hand the app a resolved copy (data.json meta.kb, meta.concerns).

usage: python build2/knowledge.py            # check, print review status counts (exit 1 on errors)
       python build2/knowledge.py --families # also list compare families that have no entry yet
       python build2/knowledge.py --schema   # print one record in the treatment information schema (field names of the
                                             # concern-discovery directive; the same records go to the database)

An entry may name a `base` entry; fields it leaves out come from the base, and extra_side_effects / extra_cautions /
sources are added to the base's. Rules checked here:
  - ids unique, bases exist, every source id exists, review.status is one of `statuses`
  - after inheritance every entry has title, one_liner, purpose
  - an 'approved' entry needs review.reviewer, review.reviewed_at and at least one source
Entries without sources are allowed (shown as '근거 자료 미정리' with their evidence_note) but counted.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "knowledge", "treatments.json")
CONCERNS = os.path.join(ROOT, "knowledge", "concerns.json")
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
        r["limitations"] = (x.get("limitations") or (b.get("limitations", []) if b else [])) + x.get("extra_limitations", [])
        sids = list(dict.fromkeys((b.get("sources", []) if b else []) + x.get("sources", [])))
        for s in sids:
            if s not in kb["sources"]:
                errors.append(f"{x['id']}: 출처 '{s}' 없음")
        r["sources"] = [dict(kb["sources"][s], id=s) for s in sids if s in kb["sources"]]
        # evidence level = the strongest KIND of document behind the text (not a grade of how well a treatment works)
        kinds = {x.get("type") for x in r["sources"]}
        r["evidence_level"] = ("public_guidance" if kinds & {"government", "academy"} else "review_article" if "review_article" in kinds
                               else "clinic_reference" if "clinic_reference" in kinds else "none")
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


def load_concerns(path=CONCERNS):
    return json.load(open(path, encoding="utf-8"))


def check_concerns(cs, entry_ids, kb):
    """errors in concerns.json: ids, treatment ids that exist in treatments.json, sources, statuses, safety patterns"""
    errors, seen = [], set()
    for rule in cs["safety"]["rules"] + [cs["safety"]["personal"]]:
        try:
            re.compile(rule["pattern"])
        except re.error as e:
            errors.append(f"safety '{rule.get('id', 'personal')}': 패턴 오류 {e}")
    for c in cs["concerns"]:
        if c["id"] in seen:
            errors.append(f"고민 id 중복: {c['id']}")
        seen.add(c["id"])
        for f in ("name", "general", "synonyms", "treatments", "non_procedural"):
            if not c.get(f):
                errors.append(f"고민 {c['id']}: '{f}'가 비어 있어요")
        errors += [f"고민 {c['id']}: 시술 '{t}'가 treatments.json에 없어요" for t in c.get("treatments", []) if t not in entry_ids]
        errors += [f"고민 {c['id']}: 출처 '{s}' 없음" for s in c.get("sources", []) if s not in kb["sources"]]
        st = c.get("review", {}).get("status")
        if st not in cs["statuses"]:
            errors.append(f"고민 {c['id']}: 검수 상태 '{st}'")
        if st == "approved" and not (c["review"].get("reviewer") and c["review"].get("reviewed_at")):
            errors.append(f"고민 {c['id']}: approved에는 검수자·검수일이 필요해요")
    return errors


def export():
    """what the app gets (data.json meta.kb, meta.concerns): resolved entries (+ the concerns each belongs to), concerns"""
    kb = load()
    entries, errors = resolve(kb)
    cs = load_concerns()
    errors += check_concerns(cs, {e["id"] for e in entries}, kb)
    if errors:
        raise SystemExit("knowledge/ 오류:\n  " + "\n  ".join(errors))
    rel = {}
    for c in cs["concerns"]:
        for t in c["treatments"]:
            rel.setdefault(t, []).append(c["id"])
    for e in entries:
        e["related_concerns"] = rel.get(e["id"], [])
    concerns = [dict(c, sources=[dict(kb["sources"][s], id=s) for s in c.get("sources", [])],
                     review={k: c.get("review", {}).get(k, "") for k in ("status", "reviewer", "reviewed_at", "notes")}) for c in cs["concerns"]]
    return ({"updated": kb.get("updated", ""), "statuses": kb["statuses"], "evidence_levels": kb.get("evidence_levels", {}), "entries": entries},
            {"updated": cs.get("updated", ""), "statuses": cs["statuses"], "safety": cs["safety"], "concerns": concerns})


def schema_records():
    """treatment information schema of the concern-discovery directive, one record per entry (also the DB rows)"""
    kb, conc = export()
    pub = {"approved": "published"}
    return [{"treatment_id": e["id"], "treatment_name": e["title"], "related_concerns": e["related_concerns"],
             "general_purpose": e["purpose"], "mechanism_overview": e["method"], "evidence_level": e["evidence_level"],
             "limitations": e["limitations"], "contraindication_information": e["cautions"], "common_risks": e["side_effects"],
             "source_references": [{"id": s["id"], "title": s["title"], "publisher": s["publisher"], "url": s["url"], "checked": s.get("checked", "")} for s in e["sources"]],
             "medical_reviewer": e["review"]["reviewer"], "reviewed_at": e["review"]["reviewed_at"],
             "publication_status": pub.get(e["review"]["status"], e["review"]["status"] or "draft")} for e in kb["entries"]]


if __name__ == "__main__":
    kb = load()
    entries, errors = resolve(kb)
    from collections import Counter
    st = Counter(e["review"]["status"] for e in entries)
    print(f"entries {len(entries)} · 검수 상태 " + ", ".join(f"{kb['statuses'][k]} {v}" for k, v in st.items()))
    print(f"근거 출처가 있는 항목 {sum(1 for e in entries if e['sources'])} · 출처 없음(근거 자료 미정리) {sum(1 for e in entries if not e['sources'])}")
    cs = load_concerns()
    errors += check_concerns(cs, {e["id"] for e in entries}, kb)
    print(f"고민 분류 {len(cs['concerns'])}개 · 위험 신호 규칙 {len(cs['safety']['rules'])}개 · 한계가 적힌 시술 {sum(1 for e in entries if e['limitations'])}/{len(entries)}")
    if "--schema" in sys.argv and not errors:
        print(json.dumps(schema_records()[1], ensure_ascii=False, indent=1))
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
