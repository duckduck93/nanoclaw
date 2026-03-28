#!/bin/bash
# NanoClaw service management

PLIST="$HOME/Library/LaunchAgents/com.nanoclaw.plist"
SERVICE="gui/$(id -u)/com.nanoclaw"

case "${1:-}" in
  start)
    launchctl load "$PLIST" 2>/dev/null || true
    launchctl kickstart "$SERVICE"
    echo "NanoClaw started"
    ;;
  stop)
    launchctl unload "$PLIST" 2>/dev/null && echo "NanoClaw stopped"
    ;;
  restart)
    launchctl kickstart -k "$SERVICE" && echo "NanoClaw restarted"
    ;;
  status)
    launchctl list | grep nanoclaw || echo "NanoClaw is not running"
    ;;
  logs)
    tail -f logs/nanoclaw.log
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
