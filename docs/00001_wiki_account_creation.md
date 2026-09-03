---
title: Criação de Conta
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: feature/account-creation
head: 3086ace8f8d7c7409758b4a923bb6e2347c93f98
---

## Demanda

Adicionar endpoint para criação de contas no ledger. A tabela `accounts` já existia no schema; a demanda era expor a operação via HTTP.

## Endpoint

### POST /accounts

**Request body:**

| Campo      | Tipo   | Obrigatório | Default | Regras                            |
|------------|--------|-------------|---------|-----------------------------------|
| `name`     | string | sim         | —       | não pode ser vazio                |
| `currency` | string | não         | `"BRL"` | exatamente 3 letras (`[A-Za-z]`)  |
| `balance`  | number | não         | `0`     | número não-negativo               |

**Response 201:**

```json
{
  "id": "uuid",
  "name": "Alice",
  "currency": "BRL",
  "balance": "1000.00",
  "created_at": "2026-09-03T00:00:00.000Z"
}
```

**Erros 400:**

| Condição                            | Mensagem                              |
|-------------------------------------|---------------------------------------|
| `name` vazio ou ausente             | `"name is required"`                  |
| `currency` inválido                 | `"currency must be a 3-letter string"`|
| `balance` não-número ou negativo    | `"balance must be a non-negative number"` |

## Fluxo

1. Validação de entrada (name, currency, balance).
2. `insertAccount(dbClient, name, currency, balance)` — INSERT retornando `id, name, currency, balance, created_at`.
3. Resposta 201 com a conta criada.

## Arquivos alterados

| Arquivo      | Mudança                                                      |
|--------------|--------------------------------------------------------------|
| `server.js`  | Função `insertAccount` + handler `POST /accounts`            |
| `account.md` | Curl de exemplo para o endpoint (novo arquivo)               |
