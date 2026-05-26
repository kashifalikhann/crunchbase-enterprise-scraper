# Use Apify's Playwright base image
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY --chown=myuser package.json package-lock.json ./

# Install dependencies with clean install
RUN npm ci --only=production --no-audit --no-fund

# Copy source code
COPY --chown=myuser . ./

# Build TypeScript
RUN npm run build

# Run as non-root user
USER myuser

# Start the actor
CMD ["npm", "start", "--silent"]
