CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    currency    CHAR(3) NOT NULL DEFAULT 'BRL',
    balance     NUMERIC(20, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    account_id  UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    amount      NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions (id) ON DELETE CASCADE,
    direction   TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount      NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_entries_account_id ON entries (account_id);
CREATE INDEX IF NOT EXISTS idx_entries_transaction_id ON entries (transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries (created_at);
