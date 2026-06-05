#!/bin/sh
set -eu

BOOTSTRAP_ENABLED="${N8N_BOOTSTRAP_IMPORT_WORKFLOWS:-1}"
BOOTSTRAP_INPUT="${N8N_BOOTSTRAP_WORKFLOW_INPUT:-/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json}"
BOOTSTRAP_PROJECT_ID="${N8N_BOOTSTRAP_PROJECT_ID:-eY86xW2dysjsQrAK}"
BOOTSTRAP_WORKFLOW_NAME="${N8N_BOOTSTRAP_WORKFLOW_NAME:-Instagram Carousel Trend Engine}"
BOOTSTRAP_ACTIVATE="${N8N_BOOTSTRAP_ACTIVATE_WORKFLOW:-1}"
BOOTSTRAP_SSL_MODE="${DB_POSTGRESDB_SSL_MODE:-require}"
BOOTSTRAP_NODE_SCRIPT='/tmp/n8n-bootstrap-instagram.js'

if [ "$BOOTSTRAP_ENABLED" = "1" ] && [ -f "$BOOTSTRAP_INPUT" ]; then
  if [ -x /usr/local/bin/node ] || command -v node >/dev/null 2>&1; then
    echo "Generating workflow bootstrap export from generator"
    WORKFLOW_OUTPUT_PATH="$BOOTSTRAP_INPUT" node /opt/n8n/tools/create-instagram-carousel-workflow.js
  fi

  cat > "$BOOTSTRAP_NODE_SCRIPT" <<'NODE'
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  host: process.env.DB_POSTGRESDB_HOST,
  port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
  database: process.env.DB_POSTGRESDB_DATABASE,
  user: process.env.DB_POSTGRESDB_USER,
  password: process.env.DB_POSTGRESDB_PASSWORD,
  ssl: String(process.env.DB_POSTGRESDB_SSL_MODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
});

function loadWorkflow(inputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function getWebhookDefinitions(workflow) {
  return (workflow.nodes || [])
    .filter((node) => String(node.type || '').includes('webhook'))
    .map((node) => {
      const path = String(node.parameters?.path || '').replace(/^\/+|\/+$/g, '');
      const method = String(node.parameters?.httpMethod || 'GET').toUpperCase();
      const isDynamic = path.split('/').some((segment) => segment.startsWith(':'));
      return {
        workflowId: workflow.id,
        webhookPath: path,
        method,
        node: node.name,
        webhookId: isDynamic ? node.webhookId || null : null,
        pathLength: isDynamic ? path.split('/').length : null,
      };
    })
    .filter((entry) => entry.webhookPath);
}

(async () => {
  await client.connect();

  const inputPath = process.env.BOOTSTRAP_INPUT;
  const workflowName = process.env.BOOTSTRAP_WORKFLOW_NAME;
  const workflow = loadWorkflow(inputPath);

  const existingWorkflow = await client.query(
    'select id, "versionId", "activeVersionId", active from workflow_entity where name = $1 limit 1',
    [workflowName],
  );

  if (!existingWorkflow.rowCount) {
    console.log(`Workflow "${workflowName}" not found in database. Import required.`);
    process.exit(10);
  }

  const current = existingWorkflow.rows[0];

  if (String(process.env.BOOTSTRAP_ACTIVATE_WORKFLOW || '1') === '1') {
    await client.query(
      'update workflow_entity set active = true, "activeVersionId" = "versionId", "updatedAt" = now() where id = $1',
      [current.id],
    );
    console.log(`Activated workflow ${current.id} with activeVersionId=${current.versionId}`);
  } else {
    await client.query(
      'update workflow_entity set "updatedAt" = now() where id = $1',
      [current.id],
    );
  }

  for (const webhook of getWebhookDefinitions(workflow)) {
    await client.query(
      `insert into webhook_entity ("webhookPath", method, node, "workflowId", "webhookId", "pathLength")
       values ($1, $2, $3, $4, $5, $6)
       on conflict ("webhookPath", method)
       do update set
         node = excluded.node,
         "workflowId" = excluded."workflowId",
         "webhookId" = excluded."webhookId",
         "pathLength" = excluded."pathLength"`,
      [
        webhook.webhookPath,
        webhook.method,
        webhook.node,
        current.id,
        webhook.webhookId,
        webhook.pathLength,
      ],
    );
  }

  console.log(`Ensured ${getWebhookDefinitions(workflow).length} webhook rows for workflow ${current.id}`);
  await client.end();
})().catch(async (error) => {
  try {
    await client.end();
  } catch {}
  console.error(error);
  process.exit(1);
});
NODE

  echo "Bootstrapping workflow import from $BOOTSTRAP_INPUT"
  if [ -n "$BOOTSTRAP_PROJECT_ID" ]; then
    echo "Target project: $BOOTSTRAP_PROJECT_ID"
    n8n import:workflow \
      --input="$BOOTSTRAP_INPUT" \
      --projectId="$BOOTSTRAP_PROJECT_ID"
  else
    n8n import:workflow --input="$BOOTSTRAP_INPUT"
  fi

  NODE_PATH="${NODE_PATH:-}" \
  DB_POSTGRESDB_HOST="${DB_POSTGRESDB_HOST:-}" \
  DB_POSTGRESDB_PORT="${DB_POSTGRESDB_PORT:-5432}" \
  DB_POSTGRESDB_DATABASE="${DB_POSTGRESDB_DATABASE:-postgres}" \
  DB_POSTGRESDB_USER="${DB_POSTGRESDB_USER:-}" \
  DB_POSTGRESDB_PASSWORD="${DB_POSTGRESDB_PASSWORD:-}" \
  DB_POSTGRESDB_SSL_MODE="$BOOTSTRAP_SSL_MODE" \
  BOOTSTRAP_WORKFLOW_NAME="$BOOTSTRAP_WORKFLOW_NAME" \
  BOOTSTRAP_INPUT="$BOOTSTRAP_INPUT" \
  BOOTSTRAP_ACTIVATE_WORKFLOW="$BOOTSTRAP_ACTIVATE" \
  node "$BOOTSTRAP_NODE_SCRIPT"
fi

exec n8n start
