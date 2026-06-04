#!/bin/sh
set -eu

BOOTSTRAP_ENABLED="${N8N_BOOTSTRAP_IMPORT_WORKFLOWS:-1}"
BOOTSTRAP_INPUT="${N8N_BOOTSTRAP_WORKFLOW_INPUT:-/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json}"
BOOTSTRAP_PROJECT_ID="${N8N_BOOTSTRAP_PROJECT_ID:-eY86xW2dysjsQrAK}"
BOOTSTRAP_ACTIVE_STATE="${N8N_BOOTSTRAP_ACTIVE_STATE:-fromJson}"

if [ "$BOOTSTRAP_ENABLED" = "1" ] && [ -f "$BOOTSTRAP_INPUT" ]; then
  echo "Bootstrapping workflow import from $BOOTSTRAP_INPUT"
  if [ -n "$BOOTSTRAP_PROJECT_ID" ]; then
    echo "Target project: $BOOTSTRAP_PROJECT_ID"
    n8n import:workflow \
      --input="$BOOTSTRAP_INPUT" \
      --projectId="$BOOTSTRAP_PROJECT_ID" \
      --activeState="$BOOTSTRAP_ACTIVE_STATE"
  else
    n8n import:workflow \
      --input="$BOOTSTRAP_INPUT" \
      --activeState="$BOOTSTRAP_ACTIVE_STATE"
  fi
fi

exec n8n start
