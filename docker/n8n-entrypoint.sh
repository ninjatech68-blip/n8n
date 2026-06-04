#!/bin/sh
set -eu

BOOTSTRAP_ENABLED="${N8N_BOOTSTRAP_IMPORT_WORKFLOWS:-1}"
BOOTSTRAP_INPUT="${N8N_BOOTSTRAP_WORKFLOW_INPUT:-/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json}"
BOOTSTRAP_PROJECT_ID="${N8N_BOOTSTRAP_PROJECT_ID:-eY86xW2dysjsQrAK}"
BOOTSTRAP_WORKFLOW_ID="${N8N_BOOTSTRAP_WORKFLOW_ID:-9d0e57d8-6d16-4800-9e6a-8f0d4b05e88f}"
BOOTSTRAP_ACTIVATE="${N8N_BOOTSTRAP_ACTIVATE_WORKFLOW:-1}"

if [ "$BOOTSTRAP_ENABLED" = "1" ] && [ -f "$BOOTSTRAP_INPUT" ]; then
  echo "Bootstrapping workflow import from $BOOTSTRAP_INPUT"
  if [ -n "$BOOTSTRAP_PROJECT_ID" ]; then
    echo "Target project: $BOOTSTRAP_PROJECT_ID"
    n8n import:workflow \
      --input="$BOOTSTRAP_INPUT" \
      --projectId="$BOOTSTRAP_PROJECT_ID"
  else
    n8n import:workflow --input="$BOOTSTRAP_INPUT"
  fi

  if [ "$BOOTSTRAP_ACTIVATE" = "1" ] && [ -n "$BOOTSTRAP_WORKFLOW_ID" ]; then
    echo "Activating workflow: $BOOTSTRAP_WORKFLOW_ID"
    n8n update:workflow --id="$BOOTSTRAP_WORKFLOW_ID" --active=true
  fi
fi

exec n8n start
