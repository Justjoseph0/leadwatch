FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Create leads.jsonl file with proper permissions
RUN touch leads.jsonl && chmod 666 leads.jsonl

# Start the app
CMD ["node", "src/index.js"]
