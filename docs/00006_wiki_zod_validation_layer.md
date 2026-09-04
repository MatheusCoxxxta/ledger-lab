---
title: Camada de Validação via Zod (schemas por usecase + ValidationError no middleware)
data: 2026-09-03
escopo: backend
autores: Matheus Costa
branch: main
head: db7eb66ab1e691631205b7a317f3a1281dc3b0e2
---

## Demanda

Tornar a camada de validação mais robusta: substituir as validações de tipo manuais (checks inline `typeof`/regex/comparações) por **Zod schemas**. Como validação é core do domínio, os schemas ficam **próximos ao usecase** (não ao controller) — em `src/usecases/schemas/`. Cada usecase parseia a entrada com `schema.parse()` logo no início; a falha vira `ZodError`, que sobe até o error middleware e é traduzida para uma resposta 400 padronizada via nova classe `ValidationError`.

## Motivação

- Validação manual (`if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) ...`) é verbosa, fácil de divergir entre usecases e mistura parsing com regra de negócio.
- Zod centraliza o contrato de entrada num schema declarativo, único por usecase, com defaults/coerções explícitas.
- Manter o schema **junto ao usecase** (não no controller) reflete que a validação é parte do core: o usecase é o guardião da sua própria entrada, independente de quem o chama (HTTP, fila, teste).
- Uniformização do sinal de falha: `createAccount` deixa de retornar `{ error }` e passa a lançar (como `send` e `deactivateAccount` já faziam). Todo caminho de erro flui via `throw` → middleware.

## Estrutura de Arquivos

```
src/
  errors/
    ValidationError.js               ← novo: 400, agrega ZodError.issues em errors[]
  usecases/
    schemas/                         ← nova pasta: contratos de entrada dos usecases
      createAccountSchema.js
      deactivateAccountSchema.js
      sendSchema.js
server.js                            ← middleware trata ZodError antes de AppError
```

## ValidationError

```js
class ValidationError extends AppError {
    constructor(zodError) {
        super("validation error", 400);
        this.errors = zodError.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
        }));
    }
}
```

- Herda de `AppError` (status 400, `message` fixa `"validation error"`).
- Quebra o padrão "construtor sem parâmetros" das outras subclasses: é a única que carrega payload (`errors[]`), pois precisa detalhar os campos inválidos.
- `errors[]` agrega **todos** os issues do Zod (não só o primeiro) — melhoria sobre o `validate()` antigo, que retornava só a primeira mensagem.

## Schemas

```js
// createAccountSchema
z.object({
    name: z.string().trim().min(1),
    currency: z.string().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()).default("BRL"),
    balance: z.number().nonnegative().default(0),
});

// deactivateAccountSchema
z.object({ id: z.string().uuid() });

// sendSchema
z.object({
    sender_id: z.string().uuid(),
    receiver_id: z.string().uuid(),
    amount: z.number().positive(),
    idempotency_key: z.string().min(1),
});
```

Notas:
- `name`: `.trim().min(1)` — trim aplicado **antes** do `min(1)`, então string só de espaços é rejeitada (preserva a semântica do `validate()` original `name.trim() === ""`). O usecase usa `data.name` direto (já vem trimmado do schema).
- `currency`: regex 3 letras → `toUpperCase()` → default `"BRL"`. O usecase não faz mais `.toUpperCase()` (o schema já entrega em caixa alta).
- `balance`/`currency`: `.default(...)` ativa quando o campo é `undefined` (ausente). `null` explícito é **rejeitado** (tipo esperado, não null) — comportamento mais estrito que o anterior.
- `sender_id`/`receiver_id`: agora validados como UUID **antes** de tocar o banco (antes iam crus e dependiam do pg `22P02`).
- `amount`: `z.number().positive()` — sem coerção (`z.number()`, não `z.coerce`); string numérica é rejeitada.

## Error Middleware (server.js)

```js
app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
        const e = new ValidationError(err);
        return res.status(e.status).json({ message: e.message, errors: e.errors });
    }
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    if (err.code === "23505" && err.constraint === "transactions_idempotency_key_key") { ... }
    if (err.code === "22P02") { ... }
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});
```

Ordem de resolução: **1º** `ZodError` (validação de entrada) → **2º** `AppError` (negócio já tipado) → **3º** códigos pg conhecidos → **4º** fallback 500. `ZodError` é checado antes de `AppError` porque não herda dele.

## Contrato de Resposta 400 (validação)

```json
{
  "message": "validation error",
  "errors": [
    { "field": "name", "message": "Too small: expected string to have >=1 characters" }
  ]
}
```

**Breaking change** no body de erro de validação:
- `POST /accounts` antes retornava `{ "message": "name is required" }` (string única). Agora retorna o formato acima com `errors[]`.
- `POST /send`: `amount` inválido antes retornava `{ "message": "amount must be positive" }` (via `InvalidAmountError`). Agora retorna `errors[]` com `field: "amount"`.
- `PATCH /accounts/:id/deactivate`: UUID malformado antes retornava `{ "message": "invalid account id" }` (via pg `22P02` → `InvalidAccountIdError`). Agora é interceptado pelo Zod → `errors[]` com `field: "id"`.

Status HTTP (400) e paths permanecem idênticos.

## Mudanças por Arquivo

### `src/usecases/createAccount.js`
- Removida função `validate()` e o retorno `{ error }`.
- `const data = createAccountSchema.parse({ name, currency, balance })` no topo; ZodError sobe.
- Insert usa `data.name` (trimmado no schema), `data.currency` (uppercased no schema), `data.balance`.
- Mantém `return { account }` (controller inalterado nesse ponto).

### `src/usecases/deactivateAccount.js`
- `const { id: validId } = deactivateAccountSchema.parse({ id })` antes do `pool.connect()` — não adquire conexão para entrada inválida.

### `src/usecases/send.js`
- Removido import e uso de `InvalidAmountError` (guard `amount == null || amount <= 0` deletado).
- `const data = sendSchema.parse({...})` no topo; usa `data.*` em todo o fluxo.

### `src/controllers/accountController.js`
- `createAccount` perde o check `if (result.error) return res.status(400)...` — validação agora lança no usecase e o middleware trata.

### `server.js`
- Import de `{ ZodError }` (zod) e `ValidationError`.
- Middleware ganha o branch `ZodError` como primeiro check.

## Comportamento Preservado / Não Alterado

- `InvalidAmountError.js` **não** foi deletado — apenas deixou de ser usado por `send` (pode ser reutilizado).
- Handler pg `22P02` no middleware permanece (ainda cobre erros pg de UUID em outros caminhos), embora `deactivateAccount` já não dependa dele.
- Regra `sender_id === receiver_id` **não** é validada (regra de negócio fora de escopo).
- Contrato de sucesso (status/body) de todos os endpoints inalterado.

## Arquivos Alterados

| Arquivo | Ação |
|---------|------|
| `package.json` / `package-lock.json` | `zod` adicionado às dependencies |
| `src/errors/ValidationError.js` | Criado — 400, agrega `ZodError.issues` em `errors[]` |
| `src/usecases/schemas/createAccountSchema.js` | Criado |
| `src/usecases/schemas/deactivateAccountSchema.js` | Criado |
| `src/usecases/schemas/sendSchema.js` | Criado |
| `src/usecases/createAccount.js` | `validate()` → `schema.parse()`; migrado de `{ error }` → throw |
| `src/usecases/deactivateAccount.js` | `parse({ id })` antes do `pool.connect()` |
| `src/usecases/send.js` | `parse()` no topo; removido `InvalidAmountError` |
| `src/controllers/accountController.js` | Removido check `result.error` |
| `server.js` | Middleware trata `ZodError` (1º branch) |
