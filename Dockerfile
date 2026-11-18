FROM denoland/deno:latest AS cipher-builder

WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG EJS_COMMIT=cd4e87f52e87ab6d8b318fd3a817adda6fafa8dc
RUN git clone --depth 1 https://github.com/kikkia/yt-cipher.git . \
    && git init ejs \
    && cd ejs \
    && git remote add origin https://github.com/yt-dlp/ejs.git \
    && git fetch --depth 1 origin "$EJS_COMMIT" \
    && git checkout --detach FETCH_HEAD \
    && cd .. \
    && deno run --allow-read --allow-write ./scripts/patch-ejs.ts \
    && rm -rf ./ejs/.git ./ejs/node_modules \
    && deno compile --no-check --output /usr/src/app/yt-cipher --allow-net --allow-read --allow-write --allow-env --include worker.ts server.ts

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=cipher-builder /usr/src/app/yt-cipher /app/yt-cipher
COPY --from=cipher-builder /usr/src/app/docs /app/docs

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN curl -fsSL \
      https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar \
      -o /app/Lavalink.jar \
    && echo "8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a  /app/Lavalink.jar" | sha256sum -c -

ENV NODE_ENV=production

CMD ["node", "start.js"]
