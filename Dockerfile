FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY public ./public
COPY src ./src
COPY tsconfig.json ./

RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

ENV PORT=3000
ENV VIDEO_LIBRARY_PATH=/library
ENV CACHE_PATH=/cache
ENV THUMBNAIL_TIMESTAMP=15
ENV HLS_ENABLED=true

EXPOSE 3000

CMD ["npm", "start"]
