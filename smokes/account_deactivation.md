# Smoke — Desativação de Conta

Fluxo: health-check → criar conta → desativar conta → tentar enviar de/para conta desativada → reativar não existe (desativação é permanente).

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

```bash
curl http://localhost:3000/health
```

Resposta esperada (`200`):
```json
{ "status": "ok", "time": "2026-09-03T00:00:00.000Z" }
```

---

## POST /accounts — criar duas contas para o teste

```bash
# Conta A (sender) com saldo
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "currency": "BRL", "balance": 500}'

# Conta B (receiver)
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Bob", "currency": "BRL", "balance": 100}'
```

Guarde os `id`s retornados como `ACCOUNT_A` e `ACCOUNT_B`.

---

## PATCH /accounts/:id/deactivate — desativar conta

```bash
curl -X PATCH http://localhost:3000/accounts/<ACCOUNT_A>/deactivate
```

Resposta esperada (`200`):
```json
{
  "id": "<ACCOUNT_A>",
  "name": "Alice",
  "currency": "BRL",
  "balance": "500.00",
  "created_at": "2026-09-03T00:00:00.000Z",
  "deactivated_at": "2026-09-03T12:00:00.000Z"
}
```

**Idempotência — segunda chamada:**
```bash
curl -X PATCH http://localhost:3000/accounts/<ACCOUNT_A>/deactivate
```
Resposta esperada (`409`):
```json
{ "message": "account already deactivated" }
```

**Conta inexistente:**
```bash
curl -X PATCH http://localhost:3000/accounts/00000000-0000-0000-0000-000000000000/deactivate
```
Resposta esperada (`404`):
```json
{ "message": "account not found" }
```

**UUID inválido:**
```bash
curl -X PATCH http://localhost:3000/accounts/not-a-uuid/deactivate
```
Resposta esperada (`400`):
```json
{ "message": "invalid account id" }
```

---

## POST /send — bloqueio por conta desativada

```bash
# Sender desativado (ACCOUNT_A foi desativado acima)
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "smoke-deact-001",
    "sender_id": "<ACCOUNT_A>",
    "receiver_id": "<ACCOUNT_B>",
    "amount": 10
  }'
```
Resposta esperada (`400`):
```json
{ "message": "sender account is deactivated" }
```

```bash
# Receiver desativado
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "smoke-deact-002",
    "sender_id": "<ACCOUNT_B>",
    "receiver_id": "<ACCOUNT_A>",
    "amount": 5
  }'
```
Resposta esperada (`400`):
```json
{ "message": "receiver account is deactivated" }
```
