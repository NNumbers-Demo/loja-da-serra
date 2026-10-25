FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOME=/tmp

WORKDIR /app

# Remove os gerenciadores de pacotes da imagem final: a aplicação usa só os módulos nativos.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
 && true

COPY --chown=10001:10001 server.js ./
COPY --chown=10001:10001 public ./public
COPY --chown=10001:10001 data ./data

USER 10001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
