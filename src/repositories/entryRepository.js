const pool = require("../db");

const insert = async (account_id, transaction_id, direction, amount, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO entries (account_id, transaction_id, direction, amount)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [account_id, transaction_id, direction, amount]
    );
    return result.rows[0];
};

module.exports = { insert };
