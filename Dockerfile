FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY --chown=myuser . ./
RUN npm run build

USER myuser
CMD ["npm", "start", "--silent"]
