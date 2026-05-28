FROM apify/actor-node-playwright-chrome:20

COPY --chown=node package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY --chown=node . ./
RUN npm run build

USER node
CMD ["npm", "start", "--silent"]
