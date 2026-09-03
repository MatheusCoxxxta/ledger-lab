require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DATABASE_HOST || "localhost",
  port: process.env.DATABASE_PORT,
  user: process.env.DATABASE_USER || "postgres",
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

const app = express();

app.use(express.json());

const atomicGetTransaction = async (dbClient, idempotency_key, account_id, amount) => {
    const result = await dbClient.query(
        `INSERT INTO transactions (idempotency_key, account_id, amount)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [idempotency_key, account_id, amount]
    );
    return result.rows[0];
};

const selectAccount = async (dbClient, account_id) => {
    const result = await dbClient.query(
        `SELECT * FROM accounts
        WHERE id = $1`,
        [account_id]
    );
    return result.rows[0];
}

const lockSelectAccount = async (dbClient, account_id) => {
    const result = await dbClient.query(
        `SELECT * FROM accounts
        WHERE id = $1
        FOR UPDATE`,
        [account_id]
    );
    return result.rows[0];
}

const createEntry = async (dbClient, transaction_id, account_id, direction, amount) => {
    const result = await dbClient.query(
        `INSERT INTO entries (account_id, transaction_id, direction, amount)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [account_id, transaction_id, direction, amount]
    );
    return result.rows[0];
};

const updateBalance = async (dbClient, account_id, direction, amount) => {
    const delta = direction === "credit" ? amount : -amount;

    const result = await dbClient.query(
            `UPDATE accounts
            SET balance = balance + $1
            WHERE id = $2`,
            [delta, account_id]
    );

    return result.rows[0];
};

const insertAccount = async (dbClient, name, currency, balance) => {
    const result = await dbClient.query(
        `INSERT INTO accounts (name, currency, balance)
         VALUES ($1, $2, $3)
         RETURNING id, name, currency, balance, created_at`,
        [name, currency, balance]
    );
    return result.rows[0];
};

app.get("/health", async (_req, res) => {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", time: result.rows[0].now });
});

app.post("/send", async (req, res) => {
    const body = req.body;

    if(body.amount <= 0) {
        return res.status(400).json({ message: "amount must be positive" });
    }

    const dbClient = await pool.connect();

    try {
        const senderAccount = await selectAccount(dbClient, body.sender_id);

        if(!senderAccount) {
            return res.status(400).json({ message: "sender account not found" });
        }

        if (senderAccount.balance <= 0 || senderAccount.balance - body.amount < 0) {
            return res.status(400).json({ message: "insuficient balance" });
        }

        const receiverAccount = await selectAccount(dbClient, body.receiver_id);

        if(!receiverAccount) {
            return res.status(400).json({ message: "receiver account not found" });
        }

        await dbClient.query("BEGIN;");

        const lockedSenderAccount = await lockSelectAccount(dbClient, body.sender_id);

        if (lockedSenderAccount.balance <= 0 || lockedSenderAccount.balance - body.amount < 0) {
            await dbClient.query("ROLLBACK");
            return res.status(400).json({ message: "insuficient balance" });
        }

        const lockedReceiverAccount = await lockSelectAccount(dbClient, body.receiver_id);

        const transaction = await atomicGetTransaction(dbClient, body.idempotency_key, body.sender_id, body.amount);

        await createEntry(dbClient, transaction.id, lockedSenderAccount.id, "debit", body.amount);
        await createEntry(dbClient, transaction.id, lockedReceiverAccount.id, "credit", body.amount);

        await updateBalance(dbClient, body.sender_id, "debit", body.amount)
        await updateBalance(dbClient, body.receiver_id, "credit", body.amount)

        await dbClient.query("COMMIT;");

       return  res.json();
    } catch (error) {
        if(error.toString() === 'error: duplicate key value violates unique constraint "transactions_idempotency_key_key"') {
            res.status(400).json({ message: "transaction already processed" });
        }

        await dbClient.query("ROLLBACK");
    } finally {
        dbClient.release();
    }
});

app.post("/accounts", async (req, res) => {
    const { name, currency = "BRL", balance = 0 } = req.body;

    if (!name || name.trim() === "") {
        return res.status(400).json({ message: "name is required" });
    }

    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
        return res.status(400).json({ message: "currency must be a 3-letter string" });
    }

    if (typeof balance !== "number" || balance < 0) {
        return res.status(400).json({ message: "balance must be a non-negative number" });
    }

    const dbClient = await pool.connect();

    try {
        const account = await insertAccount(dbClient, name.trim(), currency.toUpperCase(), balance);
        return res.status(201).json(account);
    } finally {
        dbClient.release();
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on port ${port}`);
});
