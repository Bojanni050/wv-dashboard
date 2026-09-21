FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ai.js weekly-report.js explain.js ./
COPY public ./public
COPY fonts ./fonts

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "index.js"]
