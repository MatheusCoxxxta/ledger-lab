---
title: Refatoração em Camadas (Controllers, Usecases, Repositories)
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: refactor/folder-structure
head: 3c59dee93acd6ec350bfbd5d7c37d9cdb5306923
---

## Demanda

Reorganizar o projeto de um único arquivo `server.js` para uma arquitetura em três camadas explícitas, sem introduzir ORM ou novas dependências.

## Estrutura de Arquivos

```
src/
  db.js                              ← singleton do pg.Pool
  controllers/
    healthController.js              ← GET /health
    accountController.js             ← POST /accounts, PATCH /accounts/:id/deactivate
    transactionController.js         ← POST /send
  usecases/
    createAccount.js                 ← validação + insert de conta
    deactivateAccount.js             ← desativação atômica
    send.js                          ← transferência com lock + double-check
  repositories/
    accountRepository.js             ← queries de accounts
    transactionRepository.js         ← query de insert de transaction
    entryRepository.js               ← query de insert de entry
server.js                            ← dotenv + express + rotas + listen
```

## Responsabilidades por Camada

| Camada | Responsabilidade |
|--------|-----------------|
| **Controller** | Parse de `req`, chamada ao usecase, mapeamento de resultado para HTTP (status + body) |
| **Usecase** | Regras de negócio, validações de domínio, orquestração de repositórios, gestão de transações DB (BEGIN/COMMIT/ROLLBACK) |
| **Repository** | SQL puro via `pg.Client`, sem lógica de negócio |

## Convenções

- Sem classes — todos os módulos exportam funções via `module.exports = { fn }`.
- Todos os métodos de repository recebem `client` como primeiro argumento.
- O usecase obtém `client = await pool.connect()` e o passa aos repositories; faz `client.release()` no `finally`.
- O pool (`src/db.js`) é um singleton importado pelos usecases.
- Erros de negócio: usecase retorna objeto `{ error: 'CODE' }` — controller mapeia para status HTTP.
- Erros de infra (ex: UUID inválido, código pg `22P02`): capturados no controller via `try/catch`.
- Erro de idempotency key duplicada (`23505`): capturado no `catch` do usecase, retornado como `{ duplicateKey: true }`.

## Fluxo POST /send

```
transactionController.send
  → validação de amount (null/≤0 → 400)
  → send usecase
      → pre-check sender (findById): NOT_FOUND / DEACTIVATED / INSUFFICIENT_BALANCE
      → pre-check receiver (findById): NOT_FOUND / DEACTIVATED
      → BEGIN
      → lock sender (findByIdForUpdate): re-check DEACTIVATED / INSUFFICIENT_BALANCE
      → lock receiver (findByIdForUpdate): re-check DEACTIVATED
      → transactionRepository.insert
      → entryRepository.insert (debit sender)
      → entryRepository.insert (credit receiver)
      → accountRepository.updateBalance (sender, receiver)
      → COMMIT
      catch 23505 → ROLLBACK → { duplicateKey: true }
      catch other → ROLLBACK → throw
  → map result.error / result.duplicateKey → 400
  → sucesso → res.json() vazio
```

## Mapa de Erros — POST /send

| Código interno | Status HTTP | Mensagem |
|---------------|------------|---------|
| `SENDER_NOT_FOUND` | 400 | `"sender account not found"` |
| `SENDER_DEACTIVATED` | 400 | `"sender account is deactivated"` |
| `INSUFFICIENT_BALANCE` | 400 | `"insuficient balance"` |
| `RECEIVER_NOT_FOUND` | 400 | `"receiver account not found"` |
| `RECEIVER_DEACTIVATED` | 400 | `"receiver account is deactivated"` |
| `duplicateKey` | 400 | `"transaction already processed"` |

## Arquivos Alterados

| Arquivo | Ação |
|---------|------|
| `server.js` | Simplificado — apenas dotenv, express, imports de controllers, rotas e listen |
| `src/db.js` | Criado — singleton pg.Pool |
| `src/repositories/accountRepository.js` | Criado |
| `src/repositories/transactionRepository.js` | Criado |
| `src/repositories/entryRepository.js` | Criado |
| `src/usecases/createAccount.js` | Criado |
| `src/usecases/deactivateAccount.js` | Criado |
| `src/usecases/send.js` | Criado |
| `src/controllers/healthController.js` | Criado |
| `src/controllers/accountController.js` | Criado |
| `src/controllers/transactionController.js` | Criado |
