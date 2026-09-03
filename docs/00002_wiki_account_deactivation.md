---
title: Desativação de Conta
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: feature/disable-account
head: 3d69fdf10856bb7d098a4c17a77b88f3b253b320
---

## Demanda

Adicionar endpoint para desativar contas no ledger. Contas desativadas não podem enviar nem receber transferências via `POST /send`.

## Endpoint

### PATCH /accounts/:id/deactivate

**Path param:**

| Campo | Tipo | Descrição             |
|-------|------|-----------------------|
| `id`  | UUID | ID da conta a desativar |

**Sem body.**

**Response 200:**

```json
{
  "id": "uuid",
  "name": "Alice",
  "currency": "BRL",
  "balance": "1000.00",
  "created_at": "2026-09-03T00:00:00.000Z",
  "deactivated_at": "2026-09-03T12:00:00.000Z"
}
```

**Erros:**

| Status | Condição                     | Mensagem                        |
|--------|------------------------------|---------------------------------|
| 400    | UUID inválido no path        | `"invalid account id"`          |
| 404    | Conta não encontrada         | `"account not found"`           |
| 409    | Conta já desativada          | `"account already deactivated"` |

## Modificação em POST /send

Contas desativadas são bloqueadas em dois momentos:

1. **Antes de BEGIN** — fast-path pré-transação via `selectAccount`.
2. **Dentro da transação (após FOR UPDATE)** — garantia contra corrida entre desativação e envio concorrentes.

| Caso                      | Status | Mensagem                            |
|---------------------------|--------|-------------------------------------|
| Sender desativado         | 400    | `"sender account is deactivated"`   |
| Receiver desativado       | 400    | `"receiver account is deactivated"` |

## Fluxo de desativação

1. `UPDATE accounts SET deactivated_at = NOW() WHERE id = $1 AND deactivated_at IS NULL RETURNING ...`
2. Se `rows[0]` existir → retorna conta desativada (200).
3. Se `rows[0]` for vazio → `SELECT` para distinguir:
   - Não encontrado → 404.
   - Já desativado → 409.

O UPDATE atômico com `AND deactivated_at IS NULL` elimina a corrida (TOCTOU) que existiria com SELECT + UPDATE separados.

## Schema

```sql
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL;
```

`NULL` = conta ativa. Valor preenchido = desativada (timestamp de quando ocorreu).

## Arquivos alterados

| Arquivo      | Mudança                                                                          |
|--------------|----------------------------------------------------------------------------------|
| `server.js`  | Função `deactivateAccount` + handler `PATCH /accounts/:id/deactivate` + guards em `POST /send` |
| `init.sql`   | `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL`  |
