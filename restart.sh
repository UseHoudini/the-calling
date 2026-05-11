#!/bin/bash
# Kill any existing instances
pkill -f "node.*the-calling" 2>/dev/null
pkill -f "node.*server.js" 2>/dev/null
sleep 1
# Start fresh
cd /Users/houdini/.openclaw/workspace/magic/the-calling
node server.js > /tmp/calling.log 2>&1 &
sleep 2
curl -s http://localhost:3000/status | python3 -c "import sys,json;d=json.load(sys.stdin);print('✓ The Calling server UP — audience:', d['audienceCount'])"
