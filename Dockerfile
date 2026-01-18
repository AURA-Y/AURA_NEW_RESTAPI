# Build stage
FROM oven/bun:1.3.6-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN bun run build

# Production stage
FROM oven/bun:1.3.6-alpine

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* bun.lock* ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3002

# Start application
CMD ["bun", "run", "dist/src/main.js"]
