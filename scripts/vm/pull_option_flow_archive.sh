#!/bin/bash
# Run on the PC (Git Bash). Copies archive files the PC does not have yet from the Oracle VM into Documents/Dellegate/option_flow_archive.
# Never deletes anything on either side.
KEY="$HOME/.ssh/ssh-key-2026-10-02.key"
HOST="ubuntu@163.192.110.42"
DEST="$HOME/Documents/Dellegate/option_flow_archive"
mkdir -p "$DEST"
got=0
for f in $(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$HOST" 'ls ~/option_flow_archive 2>/dev/null | grep "\.json\.gz$"'); do
  [ -e "$DEST/$f" ] && continue
  scp -q -i "$KEY" -o BatchMode=yes "$HOST:option_flow_archive/$f" "$DEST/$f.part" && mv "$DEST/$f.part" "$DEST/$f" && got=$((got+1))
done
echo "copied $got new file(s); $(ls "$DEST" | grep -c '\.json\.gz$') on this PC in $DEST"
