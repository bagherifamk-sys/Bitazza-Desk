# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=https://csbot-api.fly.dev
ARG VITE_SERVER_URL=https://csbot-dashboard.fly.dev
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build

# Stage 2: Install Node server deps
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# Stage 3: Final image
FROM node:20-alpine
WORKDIR /app

# Copy built React assets
COPY --from=frontend-build /app/frontend/dist ./public

# Copy server source + deps
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/

# Serve React static files from Node
RUN mkdir -p server/uploads

EXPOSE 3002

CMD ["node", "server/src/index.js"]
