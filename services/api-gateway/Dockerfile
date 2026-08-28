# Прод-образ API. В отличие от Dockerfile.dev использует `npm ci` по
# package-lock.json — воспроизводимая установка ровно тех версий, что
# зафиксированы в локе (dev-flow с `npm install` подтягивал последнее
# подходящее по semver и был невоспроизводим). devDependencies у пакета нет,
# поэтому --omit=dev ничего не ломает и просто фиксирует намерение.
FROM node:20-alpine
WORKDIR /app
# poppler-utils (pdftotext/pdftoppm) + tesseract-ocr (rus+eng) — распознавание
# счетов на оплату и платёжных поручений из загруженных файлов.
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-rus
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "src/server.js"]
