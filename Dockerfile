FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY --chown=node:node . .

EXPOSE 3012
# Die Datenverzeichnisse muessen dem node-Nutzer gehoeren, BEVOR auf ihn
# gewechselt wird: Docker uebernimmt beim ersten Anlegen eines Volumes die
# Rechte des Verzeichnisses aus dem Image. Fehlt das, gehoert das Volume
# root, und die App laeuft als node in "readonly database".
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
CMD ["npm", "start"]
