FROM n8nio/n8n:2.22.5

USER root

RUN npm install -g sharp pg \
  && npm cache clean --force

COPY docker/n8n-entrypoint.sh /docker/n8n-entrypoint.sh
COPY artifacts/hosted-import/instagram-carousel-content-engine.workflow.json /opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json

RUN chmod +x /docker/n8n-entrypoint.sh

USER node

ENV N8N_PORT=7860
ENV N8N_HOST=0.0.0.0
ENV N8N_PROTOCOL=https
ENV NODE_FUNCTION_ALLOW_EXTERNAL=sharp
ENV NODE_PATH=/opt/nodejs/node-v24.15.0/lib/node_modules
ENV N8N_BOOTSTRAP_IMPORT_WORKFLOWS=1
ENV N8N_BOOTSTRAP_WORKFLOW_INPUT=/opt/n8n/bootstrap/instagram-carousel-content-engine.workflow.json
ENV N8N_BOOTSTRAP_PROJECT_ID=eY86xW2dysjsQrAK
ENV N8N_BOOTSTRAP_WORKFLOW_NAME="Instagram Carousel Trend Engine"
ENV N8N_BOOTSTRAP_ACTIVATE_WORKFLOW=1

EXPOSE 7860

ENTRYPOINT ["/docker/n8n-entrypoint.sh"]
