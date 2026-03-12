#!/bin/bash
# Refresh the Claude OAuth token in .env from the CLI's credentials file
# The claude CLI auto-refreshes tokens using the refresh token;
# this script copies the latest token into NanoClaw's .env

CREDS_FILE="$HOME/.claude/.credentials.json"
ENV_FILE="/root/NanoClaw/.env"

if [ ! -f "$CREDS_FILE" ]; then
  echo "No credentials file found" >&2
  exit 1
fi

# Trigger token refresh via the CLI (uses refresh token grant)
claude auth status > /dev/null 2>&1

NEW_TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['claudeAiOauth']['accessToken'])")

if [ -z "$NEW_TOKEN" ]; then
  echo "Failed to extract token" >&2
  exit 1
fi

sed -i "s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$NEW_TOKEN|" "$ENV_FILE"

# Restart NanoClaw to pick up the new token
pkill -f 'node.*dist/index.js' 2>/dev/null
sleep 3
fuser -k 9001/tcp 9002/tcp 2>/dev/null
sleep 1
cd /root/NanoClaw && nohup /usr/bin/node /root/NanoClaw/dist/index.js > /tmp/nanoclaw.log 2>&1 &

echo "Token refreshed and NanoClaw restarted at $(date)"
