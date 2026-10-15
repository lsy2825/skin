#!/usr/bin/env python3
"""Secret scan of what this repository publishes. Exit 1 on any finding.

usage: python tests/security/scan_secrets.py            # files tracked by git (the public repository)
       python tests/security/scan_secrets.py --history  # also every past version (git log -p)
Looks for: private keys, cloud/API tokens (GitHub, AWS, Google, Slack, Stripe, OpenAI/Anthropic style), Supabase
service_role keys and any JWT, password/secret assignments with a literal value, the PIN screen's number typed into
code (tests must read APP_PIN), and a non-empty Supabase key in app/config.js. app/data.json (scraped prices) is skipped
for the generic patterns because its strings are clinic text, not code.
"""
import base64, json, os, re, subprocess, sys

PATTERNS = [
    ("private key", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY")),
    ("GitHub token", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}")),
    ("Stripe secret", re.compile(r"\b[sr]k_live_[0-9A-Za-z]{20,}")),
    ("AI API key", re.compile(r"\bsk-(ant-|proj-)?[A-Za-z0-9_\-]{30,}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("service_role key", re.compile(r"service_role[\"']?\s*[:=]\s*[\"'][^\"']{20,}")),
    ("password/secret literal", re.compile(r"(?i)\b(password|passwd|secret|api_?key|access_?token)\b[\"']?\s*[:=]\s*[\"'][^\"'\s]{8,}[\"']")),
    ("PIN typed into code", re.compile(r"of\s+['\"]\d{4}['\"]|APP_PIN\s*=\s*['\"]?\d{4}")),
]
SKIP_GENERIC = {"app/data.json"}


def jwt_role(tok):
    try:
        body = tok.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("role", "?")
    except Exception:
        return "?"


def scan_text(name, text, out):
    if name in SKIP_GENERIC:
        return
    for label, rx in PATTERNS:
        for m in rx.finditer(text):
            hit = m.group(0)
            if label == "JWT":
                label = f"JWT (role={jwt_role(hit)})"
            if "placeholder" in text[max(0, m.start() - 80):m.end() + 80].lower() or "eyJ..." in hit:
                continue
            if label == "password/secret literal":      # an enum like access_token="access_token" is a name, not a secret
                kv = re.match(r"(?i)\W*(\w+)\W+(\w+)", hit)
                if kv and kv.group(1).lower() == kv.group(2).lower():
                    continue
            line = text.count("\n", 0, m.start()) + 1
            # never print the secret itself (CI logs of a public repository are public): kind, place, length only
            out.append(f"{name}:{line}: {label} ({len(hit)} chars, starts '{re.sub(r'[0-9]', '*', hit[:4])}')")


def main():
    out = []
    # -z + core.quotepath=off: real names, also Korean ones. Plain `git ls-files` prints "docs/\353\241..." for a non-ASCII name,
    # open() then fails and the file used to be skipped without a word (docs/로그인_설정.md was never scanned until 2026-10-15).
    # Decoded as UTF-8 on purpose: git writes names in UTF-8, and Windows would otherwise read them as cp949.
    raw = subprocess.run(["git", "-c", "core.quotepath=off", "ls-files", "-z"], capture_output=True, check=True).stdout
    files = [f for f in raw.decode("utf-8").split("\0") if f]
    for f in files:
        try:
            text = open(f, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue                                     # binary (images, fonts, .gz): not text, nothing to read
        except (FileNotFoundError, IsADirectoryError):
            if os.path.lexists(f) and not os.path.isdir(f):
                out.append(f"{f}: could not be read (tracked, but open() failed)")
            continue                                     # deleted from disk but still tracked, or a submodule folder
        scan_text(f, text, out)
    # the browser bundle: no Supabase key with a non-public role may ever be in app/config.js
    cfg = open("app/config.js", encoding="utf-8").read()
    for tok in re.findall(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", cfg):
        if jwt_role(tok) != "anon":
            out.append(f"app/config.js: Supabase key with role '{jwt_role(tok)}' in the browser bundle")
    if "--history" in sys.argv:
        log = subprocess.run(["git", "log", "-p", "--all", "--no-color", "--", ".", ":!app/data.json", ":!data2"], capture_output=True, text=True, errors="replace").stdout
        scan_text("git history", log, out)
    print("\n".join(out) if out else f"secret scan ok ({len(files)} tracked files{', history' if '--history' in sys.argv else ''})")
    sys.exit(1 if out else 0)


if __name__ == "__main__":
    main()
