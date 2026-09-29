FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ai.js intro.js report-pdf.js weekly-report.js monthly-report.js actions-report.js report-mail.js mailer.js explain.js ./
COPY lib ./lib
COPY public ./public
COPY fonts ./fonts

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "index.js"]
