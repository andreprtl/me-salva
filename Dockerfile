# Imagem leve: o projeto não tem dependências externas.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
