# Site da Loja da Serra

Site público da Loja da Serra, publicado no Zero a partir deste repositório.

## O que o site mostra

- Os pedidos **em separação** da tabela `Pedidos` do Infinite Data: cliente, quantidade de itens, valor e cidade, com o total do dia.
- Um botão **Analisar pedidos**, que pede ao agente de operação a prioridade do dia e a urgência de cada pedido, e mostra a resposta na página.

## Como é feito

- Node.js 24, só módulos nativos: sem `npm install`, sem `package.json` de dependências.
- `server.js` serve a página (`public/`) na porta `PORT` (padrão 8080, em `0.0.0.0`) e responde `GET /healthz` com `{"status":"ok"}`.
- Os pedidos ficam em `data/pedidos.json`, gerado a partir da consulta ao Infinite Data: `{ "loja": "Loja da Serra", "data_referencia": "AAAA-MM-DD", "pedidos": [...] }`.
- Visual claro: fundo off-white, detalhes em bege, tipografia limpa, responsivo.

## O agente

- O navegador chama `POST /api/analisar` no próprio servidor; o servidor chama o agente. A chave nunca vai para o navegador.
- O servidor faz `POST` em `AGENT_URL` com `?wait=60` acrescentado, cabeçalho `Authorization: Bearer AGENT_TOKEN` e corpo **exatamente** `{ "loja", "data_referencia", "pedidos" }` (o agente recusa campos a mais no topo).
- A resposta segue `contrato-agente.json`: `resumo`, `prioridade_do_dia` e `pedidos` com a urgência de cada um.
- Sem `AGENT_URL`/`AGENT_TOKEN`, a página abre normalmente e o botão explica o que falta configurar (HTTP 503).

## Publicação

- `Dockerfile` a partir de `node:24-alpine`, com `npm`, `npx` e `corepack` removidos da imagem, arquivos com dono 10001, `USER 10001`, `EXPOSE 8080` e `HEALTHCHECK` no `/healthz`.
- `AGENT_URL` e `AGENT_TOKEN` vêm dos Secrets do projeto no Zero.
