#!/bin/bash
# Run from agents/ directory: bash cf_set_env.sh
# Reads values from .env and sets them on the CF app.

APP="gmaps-dispatch-agents"
ENV_FILE=".env"

vars=(
  AICORE_AUTH_URL
  AICORE_CLIENT_ID
  AICORE_CLIENT_SECRET
  AICORE_BASE_URL
  AICORE_DEPLOYMENT_ID
  AICORE_RESOURCE_GROUP
  XSUAA_URL
  XSUAA_CLIENT_ID
  XSUAA_CLIENT_SECRET
  TEAMS_WEBHOOK_URL
  CAP_BASE_URL
  LANGCHAIN_API_KEY
)

for var in "${vars[@]}"; do
  value=$(grep "^${var}=" "$ENV_FILE" | cut -d= -f2-)
  if [ -n "$value" ]; then
    echo "Setting $var..."
    cf set-env "$APP" "$var" "$value"
  else
    echo "WARNING: $var not found in $ENV_FILE — skipping"
  fi
done

echo ""
echo "All done. Run: cf start $APP"
