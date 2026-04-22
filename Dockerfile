# Stage 1: build (better-sqlite3 precisa de compilação nativa)
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install --production

# Stage 2: runtime
FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./
COPY consumers/ ./consumers/
COPY services/ ./services/
COPY shared/ ./shared/
COPY setup/ ./setup/

USER node
