"""Send probe_out/ back as run annotations (scrape/probe.py, .github/workflows/probe-brands.yml).

Artifact and log downloads are blocked from the dev container, but a check run's annotations can be read through the
API. So probe_out/ is packed (tar.xz -> base64; xz keeps repeated rows across branches small) and cut into CHUNK-sized pieces; `split` writes them to files, `emit N`
prints pieces N..N+9 as ::notice lines (GitHub keeps 10 notices per step, 50 per job — so the workflow runs one
job per brand). Each piece starts with
"index/sent/total/sha256 " (sha256 of the whole archive) so the reader can check it reassembled every piece.
  python scrape/probe_report.py split <probe_out> <dir>      python scrape/probe_report.py emit <dir> <start>
"""
import base64, hashlib, io, os, sys, tarfile

CHUNK = 3900   # GitHub cuts an annotation message at about 4,000 characters (seen on run 38550219318)
MAX = 45       # 50 annotations per job, a few kept free for warnings


def split(src, dst):
    buf = io.BytesIO()
    # index.json first, then pages in order: if the job's annotation cap cuts the tail, the front of the archive
    # (summary + first pages) can still be stream-read
    files = sorted((os.path.join(d, f) for d, _, fs in os.walk(src) for f in fs), key=lambda p: (not p.endswith("index.json"), p))
    with tarfile.open(fileobj=buf, mode="w:xz", preset=9) as t:
        for f in files:
            t.add(f, arcname=os.path.join("probe_out", os.path.relpath(f, src)))
    raw = buf.getvalue()
    b64 = base64.b64encode(raw).decode()
    pieces = [b64[i:i + CHUNK] for i in range(0, len(b64), CHUNK)]
    os.makedirs(dst, exist_ok=True)
    sha = hashlib.sha256(raw).hexdigest()
    sent = min(len(pieces), MAX)
    if len(pieces) > MAX:
        print(f"::warning title=probe too big::{len(raw)} bytes -> {len(pieces)} pieces; only the first {MAX} are sent")
    for i, p in enumerate(pieces[:MAX]):
        with open(os.path.join(dst, f"{i:02d}"), "w") as f:
            f.write(f"{i}/{sent}/{len(pieces)}/{sha} {p}")
    print("archive", len(raw), "bytes", len(pieces), "pieces", sha)


def emit(dst, start):
    for i in range(start, start + 10):
        p = os.path.join(dst, f"{i:02d}")
        if os.path.exists(p):
            print(f"::notice title=probe-{i:02d}::{open(p).read()}")


if __name__ == "__main__":
    if sys.argv[1] == "split":
        split(sys.argv[2], sys.argv[3])
    else:
        emit(sys.argv[2], int(sys.argv[3]))
