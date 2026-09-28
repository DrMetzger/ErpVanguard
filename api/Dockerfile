FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# xmllint: validação da NF-e no XSD oficial (os esquemas vêm em node_modules/@brasil-fiscal/nfe/schemas)
RUN apk add --no-cache libxml2-utils
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
