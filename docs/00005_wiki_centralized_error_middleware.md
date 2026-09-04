---
title: Centralização de Erros no Middleware (pg codes + deactivate via throw)
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: refactor/folder-structure
head: d4591e2cb7653929633d5672a12570a8e3453fe1
---

## Demanda

Dois ajustes pós-review no PR #3, ambos consolidando o padrão de exceções tipadas iniciado na 00004:

1. **Centralizar detecção de erros pg no error middleware** — remover os checks de códigos pg (`23505`, `22P02`) espalhados em usecase (`send.js`) e controller (`accountController.js`); o middleware do `server.js` passa a ser o único ponto que traduz erro de infra (pg) → resposta HTTP.
2. **Migrar `deactivateAccount` para throw** — usecase deixa de retornar objetos-sinalizadores (`{ notFound }` / `{ alreadyDeactivated }`) e passa a lançar `AccountNotFoundError` (404) / `AccountAlreadyDeactivatedError` (409), como o `send` já fazia.

## Motivação

- Códigos pg (`23505`, `22P02`) são detalhe de infraestrutura. Ter `error.code === "23505"` dentro do usecase ou `error.code === "22P02"` dentro do controller vaza infra para camadas de negócio/HTTP.
- Concentrar a tradução pg → HTTP no middleware deixa usecases/controllers livres desse acoplamento: eles apenas deixam o erro subir.
- Uniformidade: todos os usecases (`send`, `deactivateAccount`) agora sinalizam falha via `throw`, nunca via retorno.

## Novas Classes de Erro

```
src/errors/
  InvalidAccountIdError.js           ← 400 "invalid account id"          (pg 22P02)
  AccountNotFoundError.js            ← 404 "account not found"
  AccountAlreadyDeactivatedError.js  ← 409 "account already deactivated"
```

Todas herdam de `AppError` (construtor sem parâmetros; `message` e `status` fixos). `AppError` aceita `status` não-400 — usado aqui para 404 e 409.

## Error Middleware (server.js)

```js
app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    if (err.code === "23505" && err.constraint === "transactions_idempotency_key_key") {
        const e = new DuplicateTransactionError();
        return res.status(e.status).json({ message: e.message });
    }
    if (err.code === "22P02") {
        const e = new InvalidAccountIdError();
        return res.status(e.status).json({ message: e.message });
    }
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});
```

Ordem de resolução: **1º** `AppError` (erros de negócio já tipados) → **2º** códigos pg conhecidos (infra traduzida para o AppError equivalente) → **3º** fallback 500.

## Mudanças por Arquivo

### `src/usecases/send.js`
- Removido import de `DuplicateTransactionError` e a detecção `error.code === "23505"` no inner catch.
- Inner catch agora só faz `ROLLBACK` + `throw error`. O pg error `23505` sobe cru até o middleware, que o traduz em `DuplicateTransactionError`.

### `src/usecases/deactivateAccount.js`
- `return { account }` → `return account` (retorno direto).
- `return { notFound: true }` → `throw new AccountNotFoundError()`.
- `return { alreadyDeactivated: true }` → `throw new AccountAlreadyDeactivatedError()`.

### `src/controllers/accountController.js`
- `deactivateAccount` simplificado: removido `try/catch` (incl. o check `22P02`) e os checks de resultado. Agora: `const account = await deactivateAccountUsecase(id); return res.json(account);`.
- O erro `22P02` (UUID inválido) sobe até o middleware.
- `createAccount` **não** foi alterado — segue o padrão `{ error }` (fora de escopo).

## Fluxo de Erros — PATCH /accounts/:id/deactivate

```
accountController.deactivateAccount
  → await deactivateAccount usecase
      → accountRepository.deactivate(client, id)
          ↳ UUID inválido → pg 22P02 (sobe cru)
      → se desativou → return account
      → senão → findById
          → não existe → throw AccountNotFoundError (404)
          → existe (já desativado) → throw AccountAlreadyDeactivatedError (409)
  ↳ qualquer throw → error middleware:
        AccountNotFoundError → 404
        AccountAlreadyDeactivatedError → 409
        pg 22P02 → InvalidAccountIdError → 400
        senão → 500
```

## Mapa de Erros (consolidado)

| Erro | Origem | Status | Mensagem |
|------|--------|--------|---------|
| `SenderNotFoundError` | send usecase | 400 | `"sender account not found"` |
| `SenderDeactivatedError` | send usecase | 400 | `"sender account is deactivated"` |
| `InsufficientBalanceError` | send usecase | 400 | `"insuficient balance"` |
| `ReceiverNotFoundError` | send usecase | 400 | `"receiver account not found"` |
| `ReceiverDeactivatedError` | send usecase | 400 | `"receiver account is deactivated"` |
| `DuplicateTransactionError` | middleware (pg 23505) | 400 | `"transaction already processed"` |
| `InvalidAccountIdError` | middleware (pg 22P02) | 400 | `"invalid account id"` |
| `AccountNotFoundError` | deactivate usecase | 404 | `"account not found"` |
| `AccountAlreadyDeactivatedError` | deactivate usecase | 409 | `"account already deactivated"` |
| (não-`AppError`, pg desconhecido) | middleware | 500 | `"internal server error"` |

Contrato HTTP (status + body) permanece idêntico ao anterior — muda apenas onde a tradução pg → HTTP acontece (agora centralizada no middleware).

## Arquivos Alterados

| Arquivo | Ação |
|---------|------|
| `src/errors/InvalidAccountIdError.js` | Criado |
| `src/errors/AccountNotFoundError.js` | Criado |
| `src/errors/AccountAlreadyDeactivatedError.js` | Criado |
| `src/usecases/send.js` | Removida detecção pg 23505; inner catch só ROLLBACK + rethrow |
| `src/usecases/deactivateAccount.js` | Migrado para throw; retorno direto de `account` |
| `src/controllers/accountController.js` | `deactivateAccount` simplificado; sem try/catch |
| `server.js` | Middleware traduz pg codes (23505, 22P02) em AppError equivalente |
