FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN curl -fsSL \
      https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar \
      -o /app/Lavalink.jar \
    && echo "8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a  /app/Lavalink.jar" | sha256sum -c -

ENV NODE_ENV=production

CMD ["node", "start.js"]
