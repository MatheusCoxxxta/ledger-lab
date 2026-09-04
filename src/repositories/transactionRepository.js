const pool = require("../db");

const insert = async (idempotency_key, account_id, amount, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO transactions (idempotency_key, account_id, amount)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [idempotency_key, account_id, amount]
    );
    return result.rows[0];
};

module.exports = { insert };
