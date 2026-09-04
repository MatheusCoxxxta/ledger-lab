const pool = require("../db");

const findById = async (id, executor = pool) => {
    const result = await executor.query(
        `SELECT * FROM accounts WHERE id = $1`,
        [id]
    );
    return result.rows[0];
};

const findByIdForUpdate = async (id, executor = pool) => {
    const result = await executor.query(
        `SELECT * FROM accounts WHERE id = $1 FOR UPDATE`,
        [id]
    );
    return result.rows[0];
};

const insert = async (name, currency, balance, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO accounts (name, currency, balance)
         VALUES ($1, $2, $3)
         RETURNING id, name, currency, balance, created_at`,
        [name, currency, balance]
    );
    return result.rows[0];
};

const deactivate = async (id, executor = pool) => {
    const result = await executor.query(
        `UPDATE accounts
         SET deactivated_at = NOW()
         WHERE id = $1 AND deactivated_at IS NULL
         RETURNING id, name, currency, balance, created_at, deactivated_at`,
        [id]
    );
    return result.rows[0];
};

const updateBalance = async (id, direction, amount, executor = pool) => {
    const delta = direction === "credit" ? amount : -amount;
    await executor.query(
        `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,
        [delta, id]
    );
};

module.exports = { findById, findByIdForUpdate, insert, deactivate, updateBalance };
