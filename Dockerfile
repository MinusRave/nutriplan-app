FROM node:18-slim

# Create app directory
WORKDIR /app

# Install app dependencies
# First, copy only the necessary files for npm install
COPY package*.json ./
COPY scripts/setup-directories.js ./scripts/

# Install dependencies with --omit=dev (modern equivalent of --only=production)
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Create required directories explicitly
RUN node scripts/setup-directories.js

# Expose port
EXPOSE 8080

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Start app
CMD [ "node", "app.js" ]