# Smoke — Criação de Conta

Fluxo: health-check → criar conta → transferência entre contas.

## Pré-requisitos

- Servidor local rodando: `node server.js` (ou `npm start`)
- Banco PostgreSQL local acessível com as variáveis de ambiente do `.env`
- Sem autenticação — nenhum token necessário

## Headers obrigatórios

```
Content-Type: application/json
```

---

## GET /health

Verifica se o servidor e o banco estão acessíveis.

```bash
curl http://localhost:3000/health
```

Resposta esperada (`200`):
```json
{ "status": "ok", "time": "2026-09-03T00:00:00.000Z" }
```

---

## POST /accounts

Cria uma nova conta.

```bash
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "currency": "BRL",
    "balance": 1000
  }'
```

Resposta esperada (`201`):
```json
{
  "id": "uuid-gerado",
  "name": "Alice",
  "currency": "BRL",
  "balance": "1000.00",
  "created_at": "2026-09-03T00:00:00.000Z"
}
```

**Campos opcionais:** `currency` (default `"BRL"`) e `balance` (default `0`).

---

## POST /send

Transferência entre duas contas existentes com saldo suficiente.
Requer dois `id`s de contas válidas (use os retornados por `POST /accounts`).

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "smoke-test-001",
    "sender_id": "<id-da-conta-remetente>",
    "receiver_id": "<id-da-conta-destinatária>",
    "amount": 10
  }'
```

Resposta esperada (`200`): corpo vazio (`null`).

> `idempotency_key` deve ser único por transação. Reenviar a mesma key retorna `400 transaction already processed`.
