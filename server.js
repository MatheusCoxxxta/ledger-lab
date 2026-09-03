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

const deactivateAccount = async (dbClient, account_id) => {
    const result = await dbClient.query(
        `UPDATE accounts
         SET deactivated_at = NOW()
         WHERE id = $1 AND deactivated_at IS NULL
         RETURNING id, name, currency, balance, created_at, deactivated_at`,
        [account_id]
    );

    if (result.rows[0]) {
        return { account: result.rows[0] };
    }

    const existing = await selectAccount(dbClient, account_id);
    if (!existing) {
        return { notFound: true };
    }
    return { alreadyDeactivated: true };
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

const validateCreateAccountBody = ({ name, currency, balance }) => {
    if (!name || name.trim() === "") {
        return "name is required";
    }

    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
        return "currency must be a 3-letter string";
    }

    if (typeof balance !== "number" || balance < 0) {
        return "balance must be a non-negative number";
    }

    return null;
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

        if (senderAccount.deactivated_at !== null) {
            return res.status(400).json({ message: "sender account is deactivated" });
        }

        if (senderAccount.balance <= 0 || senderAccount.balance - body.amount < 0) {
            return res.status(400).json({ message: "insuficient balance" });
        }

        const receiverAccount = await selectAccount(dbClient, body.receiver_id);

        if(!receiverAccount) {
            return res.status(400).json({ message: "receiver account not found" });
        }

        if (receiverAccount.deactivated_at !== null) {
            return res.status(400).json({ message: "receiver account is deactivated" });
        }

        await dbClient.query("BEGIN;");

        const lockedSenderAccount = await lockSelectAccount(dbClient, body.sender_id);

        if (lockedSenderAccount.deactivated_at !== null) {
            await dbClient.query("ROLLBACK");
            return res.status(400).json({ message: "sender account is deactivated" });
        }

        if (lockedSenderAccount.balance <= 0 || lockedSenderAccount.balance - body.amount < 0) {
            await dbClient.query("ROLLBACK");
            return res.status(400).json({ message: "insuficient balance" });
        }

        const lockedReceiverAccount = await lockSelectAccount(dbClient, body.receiver_id);

        if (lockedReceiverAccount.deactivated_at !== null) {
            await dbClient.query("ROLLBACK");
            return res.status(400).json({ message: "receiver account is deactivated" });
        }

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

app.patch("/accounts/:id/deactivate", async (req, res) => {
    const { id } = req.params;
    const dbClient = await pool.connect();

    try {
        const result = await deactivateAccount(dbClient, id);

        if (result.notFound) {
            return res.status(404).json({ message: "account not found" });
        }

        if (result.alreadyDeactivated) {
            return res.status(409).json({ message: "account already deactivated" });
        }

        return res.json(result.account);
    } catch (error) {
        if (error.code === "22P02") {
            return res.status(400).json({ message: "invalid account id" });
        }
        throw error;
    } finally {
        dbClient.release();
    }
});

app.post("/accounts", async (req, res) => {
    const { name, currency = "BRL", balance = 0 } = req.body;

    const validationError = validateCreateAccountBody({ name, currency, balance });
    if (validationError) {
        return res.status(400).json({ message: validationError });
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
