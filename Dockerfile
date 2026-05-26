# Use Apify's Playwright base image
FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY --chown=myuser package.json package-lock.json ./

# Install all dependencies (typescript needed for build)
RUN npm ci --no-audit --no-fund

# Copy source code
COPY --chown=myuser . ./

# Build TypeScript
RUN npm run build

# Run as non-root user
USER myuser

# Start the actor
CMD ["npm", "start", "--silent"]
