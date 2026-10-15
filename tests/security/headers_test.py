"""Security headers file for Cloudflare (app/_headers) — development brief A2 and promise 5.
Every response gets clickjacking protection (frame-ancestors 'none'), HSTS, nosniff and a referrer policy. The file must not
carry a script/connect allowlist: that lives in index.html's <meta> CSP, owned by chat B, and two copies would drift.
  python3 tests/security/headers_test.py
The live check (headers actually sent) is `wrangler dev` + curl -I, recorded in the A2 pull request.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
fails = []


def ok(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {name} | {detail}")
    if not cond:
        fails.append(name)


path = os.path.join(ROOT, "app", "_headers")
lines = [l.rstrip("\n") for l in open(path, encoding="utf-8")] if os.path.exists(path) else []
ok("app/_headers exists (Cloudflare reads it from the assets folder)", bool(lines))
rules, cur = {}, None
for l in lines:
    if not l.strip() or l.lstrip().startswith("#"):
        continue
    if not l[0].isspace():
        cur = l.strip(); rules[cur] = {}
    elif cur is not None and ":" in l:
        k, v = l.strip().split(":", 1); rules[cur][k.strip().lower()] = v.strip()
ok("one rule for every path (/*)", list(rules) == ["/*"], list(rules))
h = rules.get("/*", {})
want = {
    "content-security-policy": "frame-ancestors 'none'",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
}
for k, v in want.items():
    ok(f"{k}: {v}", h.get(k) == v, h.get(k))
ok("only these four headers (nothing else slipped in)", set(h) == set(want), sorted(set(h) - set(want)))
csp = h.get("content-security-policy", "")
directives = [d.strip().split()[0] for d in csp.split(";") if d.strip()]
ok("CSP header sets frame-ancestors only — script/connect lists stay in index.html (chat B)", directives == ["frame-ancestors"], directives)
ok("no line over Cloudflare's 2,000-character limit", all(len(l) <= 2000 for l in lines))
# the referrer policy here and the <meta> in index.html should not disagree
idx = open(os.path.join(ROOT, "app", "index.html"), encoding="utf-8").read()
m = re.search(r'<meta name="referrer" content="([^"]+)"', idx)
ok("Referrer-Policy matches index.html's <meta name=referrer>", bool(m) and m.group(1) == h.get("referrer-policy"), m and m.group(1))
# wrangler serves app/ — the file has to be inside that folder to apply
wr = open(os.path.join(ROOT, "wrangler.jsonc"), encoding="utf-8").read()
ok("wrangler.jsonc serves ./app (where _headers lives)", '"directory": "./app"' in wr)

print(f"{'FAIL: ' + str(len(fails)) + ' failing' if fails else 'ALL PASS'}")
sys.exit(1 if fails else 0)
