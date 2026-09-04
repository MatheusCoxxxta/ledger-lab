---
title: Erros de Domínio via Classes Específicas (throw + error middleware)
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: refactor/folder-structure
head: 0d50b7aa6a976a62b848a331e345809c347ede89
---

## Demanda

Substituir o padrão de erro do usecase `send` — que retornava objetos `{ error: 'CODE' }` / `{ duplicateKey: true }` mapeados no controller — por exceções tipadas. Em vez de um `CustomError` genérico com `code`+`message` passados no construtor, usar **múltiplas classes de erro específicas**, uma por caso, herdando de um base `AppError`. O tratamento HTTP passa a ser centralizado num error middleware do Express.

## Motivação

- Contrato via retorno (`{ error }`) exige que cada camada chamadora verifique manualmente o retorno — frágil e fácil de esquecer.
- `throw` deixa o erro fluir até um ponto único de tratamento.
- Classes específicas (`SenderNotFoundError`, `InsufficientBalanceError`, ...) carregam `message` e `status` fixos internamente — o call site só faz `throw new SenderNotFoundError()`, sem repetir strings/códigos.

## Estrutura de Arquivos

```
src/
  errors/
    AppError.js                    ← base (extends Error): message + status (default 400)
    SenderNotFoundError.js         ← 400 "sender account not found"
    SenderDeactivatedError.js      ← 400 "sender account is deactivated"
    InsufficientBalanceError.js    ← 400 "insuficient balance"
    ReceiverNotFoundError.js       ← 400 "receiver account not found"
    ReceiverDeactivatedError.js    ← 400 "receiver account is deactivated"
    DuplicateTransactionError.js   ← 400 "transaction already processed"
server.js                          ← + error middleware (instanceof AppError)
```

## AppError (base)

```js
class AppError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
    }
}
```

- `this.name = this.constructor.name` → cada subclasse reporta seu próprio nome.
- `Error.captureStackTrace(this, this.constructor)` → remove `AppError`/subclasse da stack trace.
- Cada erro concreto tem construtor **sem parâmetros**: `message` e `status` são fixos.

## Convenções (delta sobre a 00003)

- Erros de negócio do `send`: usecase faz `throw new <Especifica>Error()` — **não** mais `return { error }`.
- `AppError.status` define o HTTP status; `AppError.message` define o body `{ message }`.
- Tratamento centralizado no error middleware do `server.js` — Express 5 auto-encaminha rejeições async dos handlers para o middleware de erro (4 args).
- Idempotency key duplicada (`23505`): capturada no `catch` interno do usecase e convertida em `throw new DuplicateTransactionError()`.
- Fora de escopo (mantêm o padrão antigo `{ error }`/`{ notFound }`): `createAccount`, `deactivateAccount` e seus controllers.

## Fluxo POST /send (atualizado)

```
transactionController.send
  → validação de amount (null/≤0 → 400)
  → await send usecase                     (sem checar retorno)
      → pre-check sender (findById): throw SenderNotFound / SenderDeactivated / InsufficientBalance
      → pre-check receiver (findById): throw ReceiverNotFound / ReceiverDeactivated
      → BEGIN
      → try:
          → lock sender (findByIdForUpdate): re-check → throw SenderDeactivated / InsufficientBalance
          → lock receiver (findByIdForUpdate): re-check → throw ReceiverDeactivated
          → transactionRepository.insert
          → entryRepository.insert (debit sender)
          → entryRepository.insert (credit receiver)
          → accountRepository.updateBalance (sender, receiver)
          → COMMIT
      → catch: ROLLBACK
          → se 23505 → throw DuplicateTransactionError
          → senão → throw error
  → sucesso → res.json() vazio
  ↳ qualquer throw → error middleware:
        instanceof AppError → status/message do erro
        senão → 500 "internal server error"
```

Nota: os pre-checks lançam **antes** do `BEGIN`, fora do `try` interno — nenhum `ROLLBACK` é emitido para transação inexistente. O `try` interno cobre só o bloco transacional.

## Error Middleware (server.js)

```js
app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});
```

## Mapa de Erros — POST /send

| Classe | Status HTTP | Mensagem |
|--------|------------|---------|
| `SenderNotFoundError` | 400 | `"sender account not found"` |
| `SenderDeactivatedError` | 400 | `"sender account is deactivated"` |
| `InsufficientBalanceError` | 400 | `"insuficient balance"` |
| `ReceiverNotFoundError` | 400 | `"receiver account not found"` |
| `ReceiverDeactivatedError` | 400 | `"receiver account is deactivated"` |
| `DuplicateTransactionError` | 400 | `"transaction already processed"` |
| (não-`AppError`) | 500 | `"internal server error"` |

O contrato HTTP (status + body) permanece idêntico ao da 00003 — só muda o mecanismo interno (throw vs. return).

## Arquivos Alterados

| Arquivo | Ação |
|---------|------|
| `src/errors/AppError.js` | Criado — base class |
| `src/errors/SenderNotFoundError.js` | Criado |
| `src/errors/SenderDeactivatedError.js` | Criado |
| `src/errors/InsufficientBalanceError.js` | Criado |
| `src/errors/ReceiverNotFoundError.js` | Criado |
| `src/errors/ReceiverDeactivatedError.js` | Criado |
| `src/errors/DuplicateTransactionError.js` | Criado |
| `src/errors/CustomError.js` | Removido — substituído pelas classes específicas |
| `src/usecases/send.js` | `throw new <Especifica>Error()` no lugar de `return { error }`; `try` interno para o bloco transacional |
| `src/controllers/transactionController.js` | Removido map `errorMessages` e checks de `result` — delega ao middleware |
| `server.js` | Adicionado error middleware `instanceof AppError` |
