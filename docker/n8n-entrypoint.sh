#!/bin/sh
set -eu

BOOTSTRAP_ENABLED="${N8N_BOOTSTRAP_IMPORT_WORKFLOWS:-1}"
BOOTSTRAP_INPUT="${N8N_BOOTSTRAP_WORKFLOW_INPUT:-/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json}"
BOOTSTRAP_PROJECT_ID="${N8N_BOOTSTRAP_PROJECT_ID:-eY86xW2dysjsQrAK}"
BOOTSTRAP_WORKFLOW_NAME="${N8N_BOOTSTRAP_WORKFLOW_NAME:-Instagram Carousel Trend Engine}"
BOOTSTRAP_ACTIVATE="${N8N_BOOTSTRAP_ACTIVATE_WORKFLOW:-1}"
BOOTSTRAP_SSL_MODE="${DB_POSTGRESDB_SSL_MODE:-require}"

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
    echo "Activating workflow by database flag: $BOOTSTRAP_WORKFLOW_NAME"
    NODE_PATH="${NODE_PATH:-}" \
    DB_POSTGRESDB_HOST="${DB_POSTGRESDB_HOST:-}" \
    DB_POSTGRESDB_PORT="${DB_POSTGRESDB_PORT:-5432}" \
    DB_POSTGRESDB_DATABASE="${DB_POSTGRESDB_DATABASE:-postgres}" \
    DB_POSTGRESDB_USER="${DB_POSTGRESDB_USER:-}" \
    DB_POSTGRESDB_PASSWORD="${DB_POSTGRESDB_PASSWORD:-}" \
    DB_POSTGRESDB_SSL_MODE="$BOOTSTRAP_SSL_MODE" \
    BOOTSTRAP_WORKFLOW_NAME="$BOOTSTRAP_WORKFLOW_NAME" \
    node <<'NODE'
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_POSTGRESDB_HOST,
  port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
  database: process.env.DB_POSTGRESDB_DATABASE,
  user: process.env.DB_POSTGRESDB_USER,
  password: process.env.DB_POSTGRESDB_PASSWORD,
  ssl: String(process.env.DB_POSTGRESDB_SSL_MODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  await client.connect();
  const result = await client.query(
    'update workflow_entity set active = true, "updatedAt" = now() where name = $1 returning id',
    [process.env.BOOTSTRAP_WORKFLOW_NAME],
  );
  await client.end();
  if (!result.rowCount) {
    throw new Error(`Workflow not found for activation: ${process.env.BOOTSTRAP_WORKFLOW_NAME}`);
  }
  console.log(`Activated workflow ${result.rows[0].id}`);
})().catch(async (error) => {
  try {
    await client.end();
  } catch {}
  console.error(error);
  process.exit(1);
});
NODE
  fi
fi

exec n8n start
