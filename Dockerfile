FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/ ./
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]