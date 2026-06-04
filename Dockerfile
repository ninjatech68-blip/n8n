FROM n8nio/n8n:2.22.5

USER root

RUN npm install -g sharp \
  && npm cache clean --force

USER node

ENV N8N_PORT=7860
ENV N8N_HOST=0.0.0.0
ENV N8N_PROTOCOL=https
ENV NODE_FUNCTION_ALLOW_EXTERNAL=sharp
ENV NODE_PATH=/opt/nodejs/node-v24.15.0/lib/node_modules

EXPOSE 7860

CMD ["start"]
