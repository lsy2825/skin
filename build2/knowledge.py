#!/usr/bin/env python3
"""Treatment Knowledge Base (knowledge/treatments.json), concern taxonomy (knowledge/concerns.json) and spec notes
(knowledge/specs.json): check them and hand the app a resolved copy (data.json meta.kb with meta.kb.specs, meta.concerns).

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
Spec notes (2026-10-15, 지시서 C7): one plain line per spec word inside a compare family ('리쥬란' › 'HB 플러스', '보톡스' ›
'사각턱'): what the word means, no effect / safety / recommendation words (checked by SPEC_BAN), always a review status.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "knowledge", "treatments.json")
CONCERNS = os.path.join(ROOT, "knowledge", "concerns.json")
SPECS = os.path.join(ROOT, "knowledge", "specs.json")
FIELDS = ["one_liner", "purpose", "areas", "method", "kinds", "evidence_note"]
# a spec note says what a word means; these turn it into a promise, a safety claim or advice (지시서 C7: 효과·안전 판단 없이)
SPEC_BAN = re.compile(r"효과|개선|안전|부작용|통증|좋아|좋은|확실|추천|권해|강력|더\s*오래|오래\s*가|탄력|동안|젊어|최고|최신|우수|뛰어")


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
    sp = load_specs()
    errors += check_specs(sp, kb["statuses"], kb["sources"], family_ids())
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
    # the app gets the line and its review status; refs, confidence and the reviewers' notes stay in the file
    specs = [{"fid": e["fid"], "spec": e["spec"], "one_liner": e["one_liner"], "sources": [dict(kb["sources"][s], id=s) for s in e.get("sources", [])],
              "review": {k: e.get("review", {}).get(k, "") for k in ("status", "reviewer", "reviewed_at")}} for e in sp.get("entries", [])]
    return ({"updated": kb.get("updated", ""), "statuses": kb["statuses"], "evidence_levels": kb.get("evidence_levels", {}), "entries": entries,
             "specs": specs},
            {"updated": cs.get("updated", ""), "statuses": cs["statuses"], "safety": cs["safety"], "concerns": concerns})


def load_specs(path=SPECS):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"entries": []}


def check_specs(sp, statuses, sources, fids=None):
    """spec notes: known family id (when given), a word, a one-line note without effect / safety words, a review status,
    known source ids; one note per (family, word)"""
    errors, seen = [], set()
    for i, e in enumerate(sp.get("entries", [])):
        tag = f"specs[{i}] {e.get('fid')}/{e.get('spec')}"
        if not e.get("fid") or not e.get("spec") or not e.get("one_liner"):
            errors.append(f"{tag}: fid·spec·one_liner가 필요해요")
            continue
        if fids is not None and e["fid"] not in fids:
            errors.append(f"{tag}: 없는 제품군 id")
        if (e["fid"], e["spec"]) in seen:
            errors.append(f"{tag}: 같은 낱말 설명이 두 번")
        seen.add((e["fid"], e["spec"]))
        bad = SPEC_BAN.search(e["one_liner"])
        if bad:
            errors.append(f"{tag}: 효과·안전·권유 낱말 '{bad.group()}'")
        if len(e["one_liner"]) > 80:
            errors.append(f"{tag}: 한 줄이 너무 길어요({len(e['one_liner'])}자)")
        if e.get("review", {}).get("status") not in statuses:
            errors.append(f"{tag}: 검수 상태가 없어요")
        for s in e.get("sources", []):
            if s not in sources:
                errors.append(f"{tag}: 없는 출처 {s}")
        for u in e.get("refs", []):
            if not re.match(r"https?://[^\s]+$", u):
                errors.append(f"{tag}: 참고 주소가 이상해요 {u!r}")
    return errors


def family_ids():
    """compare family ids from build2/taxonomy.py (the spec notes hang on them)"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import taxonomy
    return {f["id"] for f in taxonomy.FAMILIES}


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
    sp = load_specs()
    errors += check_specs(sp, kb["statuses"], kb["sources"], family_ids())
    se = sp.get("entries", [])
    print(f"규격 낱말 설명 {len(se)}개 · 참고 주소 있음 {sum(1 for e in se if e.get('sources') or e.get('refs'))} · "
          f"검수 상태 {dict(sorted(Counter(e.get('review', {}).get('status', '') for e in se).items()))}")
    # the ban list itself: a note that promises or advises is refused, a plain one passes
    bad = check_specs({"entries": [{"fid": "x", "spec": "a", "one_liner": "효과가 더 오래가요", "review": {"status": "draft"}},
                                   {"fid": "x", "spec": "b", "one_liner": "턱 옆 씹는 근육 부위에 놓아요", "review": {"status": "draft"}}]},
                      kb["statuses"], kb["sources"])
    if len(bad) != 1:
        errors.append(f"규격 설명 검사 자체가 이상해요: {bad}")
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
