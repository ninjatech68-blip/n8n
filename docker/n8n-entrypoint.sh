#!/bin/sh
set -eu

BOOTSTRAP_ENABLED="${N8N_BOOTSTRAP_IMPORT_WORKFLOWS:-1}"
BOOTSTRAP_INPUT="${N8N_BOOTSTRAP_WORKFLOW_INPUT:-/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json}"
BOOTSTRAP_PROJECT_ID="${N8N_BOOTSTRAP_PROJECT_ID:-eY86xW2dysjsQrAK}"
BOOTSTRAP_WORKFLOW_NAME="${N8N_BOOTSTRAP_WORKFLOW_NAME:-Instagram Carousel Trend Engine}"
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

  if [ "$BOOTSTRAP_ACTIVATE" = "1" ] && [ -n "$BOOTSTRAP_WORKFLOW_NAME" ]; then
    BOOTSTRAP_RESOLVED_ID="$(n8n list:workflow | awk -F'|' -v name=\"$BOOTSTRAP_WORKFLOW_NAME\" '$2 == name { print $1; exit }')"
    if [ -n "$BOOTSTRAP_RESOLVED_ID" ]; then
      echo "Activating workflow: $BOOTSTRAP_RESOLVED_ID"
      n8n update:workflow --id="$BOOTSTRAP_RESOLVED_ID" --active=true
    else
      echo "Failed to resolve workflow id for: $BOOTSTRAP_WORKFLOW_NAME" >&2
      exit 1
    fi
  fi
fi

exec n8n start
