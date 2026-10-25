# Painel da Loja da Serra

Painel web de pedidos de uma loja fictícia: uma página escura e responsiva com os pedidos do dia, cartões de totais e um botão **Analisar com IA** que pede ao agente de pedidos a prioridade do dia e a urgência de cada pedido.

Node.js puro — só módulos nativos, sem `npm install`.

## Rodar

```bash
node server.js
# http://localhost:8080
```

Variáveis de ambiente:

| Variável | Para que serve |
| --- | --- |
| `PORT` | Porta do servidor (padrão `8080`). Escuta em `0.0.0.0`. |
| `AGENT_URL` | Endpoint síncrono do agente (`?wait=60` é acrescentado pelo servidor). |
| `AGENT_TOKEN` | Token enviado em `Authorization: Bearer <token>`. |

Sem `AGENT_URL`/`AGENT_TOKEN` o painel abre normalmente; apenas o botão de IA responde **503** com uma mensagem explicando o que falta configurar.

```bash
PORT=3000 AGENT_URL=https://agente.exemplo/analisar AGENT_TOKEN=... node server.js
```

## Rotas

- `GET /` — página única (`public/`).
- `GET /healthz` — status do processo e se o agente está configurado.
- `GET /api/pedidos` — loja, data de referência e pedidos de `data/pedidos.json`.
- `POST /api/analisar` — envia `{loja, data_referencia, pedidos}` ao agente e devolve `{resumo, prioridade_do_dia, pedidos[], totais}`.

## Dados

`data/pedidos.json` guarda os 5 pedidos de demonstração (contrato em `contrato-agente.json`). Edite o arquivo e recarregue a página — não há banco.

## Docker

```bash
docker build -t loja-da-serra .
docker run --rm -p 8080:8080 -e AGENT_URL=... -e AGENT_TOKEN=... loja-da-serra
```

Imagem `node:24-alpine` sem `npm`, `npx` ou `corepack`, rodando como usuário `10001` e sem gravar nada fora de `/tmp`.
