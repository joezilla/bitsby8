# Build stage
FROM node:18-bookworm-slim AS build

# Install build tools for native modules (better-sqlite3, serialport)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Build Svelte frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Production stage
FROM node:18-bookworm-slim

# Runtime dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist

# Create directories for data
RUN mkdir -p /data/disks /data/cassettes /data/scripts

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js", "--web", "--webHost", "0.0.0.0", "--dataDir", "/data"]
