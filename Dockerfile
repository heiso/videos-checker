# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine

# Install ffmpeg (includes ffprobe)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy built files and production dependencies
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev

# Create directories for data and videos
RUN mkdir -p /data /videos

# Environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/data

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
