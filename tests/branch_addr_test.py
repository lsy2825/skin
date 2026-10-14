"""Branch address picking (scrape/branches.py) on saved public pages (tests/fixtures/branches, read by the address probe
on 2026-10-15, scripts stripped). The page shows the company address first and the branch's own after it (유앤아이 수원·
광교); an address with no 시군구 (세종) or with 읍·면 (양산); a page that shows only the company address (목포) — that
branch gets no address rather than the company's.
  python3 tests/branch_addr_test.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scrape"))
from bs4 import BeautifulSoup
import branches as B

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "branches")
fails = []


def cands(name):
    html = open(os.path.join(FX, name), encoding="utf-8").read()
    return B.addr_candidates(BeautifulSoup(html, "html.parser").get_text(" "))


def check(label, got, want):
    ok = got == want
    print(("PASS" if ok else "FAIL"), "|", label, "|", got)
    if not ok:
        fails.append(label)


check("세종: 시군구 없는 도로명", cands("vands_sejong_location.html")[:1], ["세종특별자치시 나성북로 15"])
check("양산: 읍 다음 도로명", cands("vands_yangsan_location.html")[:1], ["경남 양산시 물금읍 범어로 96"])
rows = [{"brand": "유앤아이", "branch": b, "cands": [(a, a) for a in cands(f)]}
        for b, f in (("수원점", "uandi_suwon_direction.html"), ("광교점", "uandi_gwanggyo_direction.html"), ("목포점", "uandi_mokpo_direction.html"))]
got = {r["branch"]: r["address"] for r in B.pick_own(rows)}
check("수원: 회사 주소 다음의 자기 주소", got["수원점"], "경기도 수원시 팔달구 인계동 1113-5")
check("광교: 회사 주소 다음의 자기 주소", got["광교점"], "경기 수원시 영통구 이의동 1333")
check("목포: 회사 주소뿐 → 주소 없음(엉뚱한 지역 대신)", got["목포점"], "")
check("기존 패턴이 먼저: 도로명이 있으면 느슨한 패턴은 쓰지 않음", B.addr_candidates("서울 강남구 테헤란로 123 · 세종 나성북로 15"), ["서울 강남구 테헤란로 123"])
print(f"PASS: {6 - len(fails)} / 6", "| 0 failing" if not fails else f"| failing: {fails}")
sys.exit(1 if fails else 0)
