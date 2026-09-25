#!/bin/bash
# Re-arm the live demo. Run any time: leaves the scratch dir in the exact
# pre-demo state — pre-built site with the placeholder hero, no downloaded
# images, no gallery page, and a fresh Claude conversation for --continue.
cd "$(dirname "$0")" || exit 1

# 1) pre-built site back to baseline (placeholder hero, original wording)
rsync -a --delete demo-baseline/site/ claude-scratch/site/

# 2) no leftovers from a previous image-search run
rm -rf claude-scratch/images claude-scratch/image_results.html

# 3) fresh conversation: archive session files so `claude -p --continue`
#    falls back to a new one (server.py handles that fallback)
SESS="$HOME/.claude/projects/-Users-macminivince-vince-assistant-workspace-boson-bridge-claude-scratch"
mkdir -p session-archive
mv "$SESS"/*.jsonl session-archive/ 2>/dev/null

echo "demo re-armed: placeholder hero, no images/, no gallery, fresh conversation"
