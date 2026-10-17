#!/usr/bin/env bash
# view-docs.sh — browse the project's OKF knowledge bundles as an HTML graph.
#
# Usage:
#   ./view-docs.sh    build one graph spanning every bundle under knowledge/
#                     and open it in the browser
#
# Regenerates knowledge/viz.html, serves knowledge/ over localhost (bound
# to 127.0.0.1), opens it in the browser, and shuts the server down after
# 2 hours (or immediately when this script is Ctrl-C'd / killed).
#
# The unified view gives concept ids a bundle prefix (db/users,
# api/login-with-passcode), so cross-bundle links become real edges.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KNOWLEDGE_DIR="$REPO_ROOT/knowledge"
OKF="${OKF_CHECKOUT:-$HOME/Projects/open-knowledge-format}"
TIMEOUT_SECS=$((2 * 60 * 60))

die() { echo "error: $*" >&2; exit 1; }

[ $# -eq 0 ] || die "no arguments needed — all bundles are always shown (got: $*)"
[ -d "$KNOWLEDGE_DIR" ] || die "no knowledge/ directory in $REPO_ROOT"
[ -f "$OKF/.venv/bin/python" ] || die "OKF venv missing at $OKF/.venv — run the setup from the okf skill first"

# --- generate unified viz.html ------------------------------------------------
# The reference viewer has two blind spots for this repo's link style, so we
# patch both:
#   1. generator: bundle-root-absolute links (/users.md) are ignored as
#      edges -> resolve them against the doc's own top-level bundle dir.
#   2. viewer JS: /users.md in a rendered body maps to id "users" -> also
#      index each node by its last path segment so it finds "db/users".
echo "Generating unified viz for all bundles..."
"$OKF/.venv/bin/python" - "$OKF/src" "$KNOWLEDGE_DIR" "$KNOWLEDGE_DIR/viz.html" "$(basename "$REPO_ROOT"): all bundles" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
import reference_agent.viewer.generator as g

root = Path(sys.argv[2]).resolve()
out = Path(sys.argv[3])
name = sys.argv[4]

orig_extract = g._extract_links

def extract(body, doc_dir, bundle_root):
    links = orig_extract(body, doc_dir, bundle_root)
    seen = set(links)
    try:
        parts = doc_dir.resolve().relative_to(bundle_root).parts
    except ValueError:
        parts = ()
    if parts:  # docs live in <root>/<bundle>/... — resolve /x.md against <root>/<bundle>
        bundle_dir = bundle_root.joinpath(*parts[:1])
        for m in g._LINK_RE.finditer(body):
            target = m.group(1)
            if not target.startswith("/") or "://" in target:
                continue
            p = (bundle_dir / target.lstrip("/")).resolve()
            try:
                rel = p.relative_to(bundle_root).as_posix()
            except ValueError:
                continue
            if rel.endswith(".md"):
                rel = rel[:-3]
            if rel and rel not in seen:
                seen.add(rel)
                links.append(rel)
    return links

g._extract_links = extract
stats = g.generate_visualization(root, out, bundle_name=name)
print(f"Wrote {stats['concepts']} concept(s), {stats['edges']} edge(s) -> {out}")

html = out.read_text(encoding="utf-8")
anchor = "for (const n of bundle.nodes) nodeIndex[n.data.id] = n.data;"
shim = anchor + """
  for (const id of Object.keys(nodeIndex)) {  // unified view: /users.md -> db/users
    const seg = id.split("/").pop();
    if (!nodeIndex[seg]) nodeIndex[seg] = nodeIndex[id];
  }"""
if anchor in html:
    out.write_text(html.replace(anchor, shim, 1), encoding="utf-8")
else:
    print("warning: could not patch viewer JS for unified links (upstream changed?)", file=sys.stderr)
PY

# --- pick a free localhost port -----------------------------------------------
PORT=$(python3 - <<'EOF'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
EOF
)

# --- start server (dies after TIMEOUT_SECS) ------------------------------------
timeout --signal=TERM "$TIMEOUT_SECS" \
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$KNOWLEDGE_DIR" >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- open browser ----------------------------------------------------------------
URL="http://127.0.0.1:$PORT/viz.html"
echo "Serving $KNOWLEDGE_DIR"
echo "  URL:     $URL"
echo "  Timeout: ${TIMEOUT_SECS}s (server auto-closes; also Ctrl-C here)"
echo "  Ctrl-C in this terminal closes the server early."

command -v xdg-open >/dev/null 2>&1 || die "xdg-open not found (no browser to open)"
xdg-open "$URL" || echo "warning: failed to open browser — open $URL manually" >&2

# --- keep script alive until server exits (timeout or kill) ----------------------
wait "$SERVER_PID" || true
echo "Server closed."
