FROM apify/actor-node:20

COPY --chown=myuser package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --production

COPY --chown=myuser . ./
RUN npm run build

USER myuser
CMD ["npm", "start", "--silent"]
