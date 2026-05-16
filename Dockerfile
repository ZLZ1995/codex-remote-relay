FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY relay-server.js ./

ENV NODE_ENV=production

CMD ["node", "relay-server.js"]
