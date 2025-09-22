FROM node:18-alpine
WORKDIR /app

# Install only production deps by default
COPY package*.json ./
RUN npm ci --omit=dev

# Copy sources
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]