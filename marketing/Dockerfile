FROM node:22-alpine
WORKDIR /site
COPY --chown=node:node package.json server.mjs legacy-app.mjs routes.json ./
COPY --chown=node:node public ./public
ENV HOST=0.0.0.0
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
