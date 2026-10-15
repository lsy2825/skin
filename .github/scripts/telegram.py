#!/usr/bin/env python3
"""Send one plain-text Telegram message (monitoring alerts: docs/SECURITY_ARCHITECTURE.md §9).

usage: python .github/scripts/telegram.py "text ..."        # text from the arguments
       some-command | python .github/scripts/telegram.py -   # text from stdin

Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (GitHub Actions repository secrets). Standard library only.
Always exits 0: monitoring must never break the price factory. Missing secrets → one ::notice line; a failed send →
one ::warning line with the HTTP status and Telegram's own description, nothing else.

The Bot API puts the token in the URL path (https://api.telegram.org/bot<token>/sendMessage), so the URL is never
printed: no exception text, no e.url / e.filename / request.full_url, no debug output — only status codes, exception
class names and Telegram's 'description' field, and even those pass through redact() first.
TELEGRAM_API_BASE may point at a local fake server for tests (only http://127.0.0.1 / http://localhost); otherwise api.telegram.org.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://api.telegram.org"
LIMIT = 4096                                  # Telegram's text limit (counted after entity parsing; we send plain text)
CUT = "\n…(이하 생략, 실행 기록 참고)"
MAX_WAIT = 60                                  # a 429 asking for longer than this is not waited for in a CI step
RETRY_WAIT = 3                                 # 5xx or no connection: one more try after a short pause
TOKEN_LIKE = re.compile(r"\d{5,}:[A-Za-z0-9_-]{20,}")


def emit(line):
    # GitHub workflow commands are one line each; a newline inside would end the command early
    print(" ".join(str(line).split()), flush=True)


def utf16_len(s):
    return len(s.encode("utf-16-le")) // 2


def trim(text, limit=LIMIT):
    """plain text that fits Telegram's limit; long text is cut at a line end when one is near, with a short note"""
    text = (text or "").strip() or "(빈 메시지)"
    if utf16_len(text) <= limit:
        return text
    room = limit - utf16_len(CUT)
    cut = text[:room]
    while utf16_len(cut) > room:               # characters outside the BMP count twice
        cut = cut[:-1]
    nl = cut.rfind("\n")
    if nl > room * 0.7:
        cut = cut[:nl]
    return cut.rstrip() + CUT


def redact(s, token=""):
    """remove the token (raw and URL-encoded) and anything shaped like a bot token from text we print or send"""
    s = str(s)
    if token:
        for t in {token, urllib.parse.quote(token), urllib.parse.quote(token, safe="")}:
            s = s.replace(t, "***")
    return TOKEN_LIKE.sub("***", s)


def api_base(env):
    base = (env.get("TELEGRAM_API_BASE") or API).rstrip("/")
    # only Telegram itself, or a local fake server in tests: the token travels in the URL, so no other host may receive it
    ok = base == API or re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", base)
    return base if ok else None


def post_json(url, payload, urlopen, timeout=20):
    """(status, parsed JSON or None). HTTP errors come back as a status, not as an exception."""
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as r:
            status, raw = r.status, r.read(65536)
    except urllib.error.HTTPError as e:        # its .url / .filename hold the token: read only code and body
        status, raw = e.code, e.read(65536) if e.fp else b""
        e.close()
    try:
        return status, json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return status, None


def hint(status, desc, params):
    d = (desc or "").lower()
    if params.get("migrate_to_chat_id"):
        return "그룹 번호가 바뀌었어요. TELEGRAM_CHAT_ID secret을 새 번호로 바꿔 주세요"
    if status == 401 or status == 404:
        return "봇 토큰을 확인해 주세요 (TELEGRAM_BOT_TOKEN secret)"
    if status == 403 or "chat not found" in d:
        return "대화 번호(TELEGRAM_CHAT_ID)와, 봇에게 먼저 말을 걸었는지 또는 봇이 그룹에 있는지 확인해 주세요"
    if status == 429:
        return "텔레그램이 잠시 보내기를 막았어요. 다음 실행에서 다시 보내요"
    if status is None or status >= 500:
        return "텔레그램 서버에 닿지 못했어요. 다음 실행에서 다시 보내요"
    return "실행 기록을 확인해 주세요"


def send(text, env=None, urlopen=None, sleep=time.sleep):
    """send one message. Returns 'sent', 'skipped' (no secrets) or 'failed'. Never raises, never prints the token."""
    env = os.environ if env is None else env
    urlopen = urlopen or urllib.request.urlopen
    token = (env.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (env.get("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat:
        emit("::notice title=텔레그램::TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID secret이 없어서 알림을 보내지 않았어요")
        return "skipped"
    base = api_base(env)
    if not base:
        emit("::warning title=텔레그램::TELEGRAM_API_BASE 값이 허용된 형태가 아니라서 보내지 않았어요")
        return "failed"
    url = f"{base}/bot{token}/sendMessage"
    payload = {"chat_id": chat, "text": trim(redact(text, token)), "link_preview_options": {"is_disabled": True}}
    status, body, err = None, None, ""
    for attempt in (1, 2):
        status, body, err = None, None, ""
        try:
            status, body = post_json(url, payload, urlopen)
        except Exception as e:                 # URLError, timeout, anything else: the class name only (str(e) could carry the URL)
            err = type(e).__name__
        if status == 200 and isinstance(body, dict) and body.get("ok"):
            emit("텔레그램 알림을 보냈어요")
            return "sent"
        params = (body.get("parameters") or {}) if isinstance(body, dict) else {}
        wait = None
        if status == 429:
            try:
                wait = int(params.get("retry_after") or 5)
            except (TypeError, ValueError):
                wait = 5
            wait = wait if 0 <= wait <= MAX_WAIT else None
        elif status is None or status >= 500:
            wait = RETRY_WAIT
        if attempt == 1 and wait is not None:
            emit(f"텔레그램 보내기 실패 ({'HTTP ' + str(status) if status else err}) — {wait}초 뒤 한 번 더 보내요")
            sleep(wait)
            continue
        break
    params = (body.get("parameters") or {}) if isinstance(body, dict) else {}
    desc = redact((body.get("description") or "") if isinstance(body, dict) else "", token)[:200]
    what = f"HTTP {status}" + (f": {desc}" if desc else "") if status else (err or "알 수 없는 오류")
    emit(f"::warning title=텔레그램::알림을 보내지 못했어요 ({what}) — {hint(status, desc, params)}")
    return "failed"


def main(argv):
    if argv == ["-"] or not argv:
        text = sys.stdin.read()
    else:
        text = " ".join(argv)
    send(text)
    return 0


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as e:                     # last line of defence: still no message text, URL or token
        emit(f"::warning title=텔레그램::알림 스크립트 오류 ({type(e).__name__})")
    sys.exit(0)
