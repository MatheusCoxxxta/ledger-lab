const insert = async (client, idempotency_key, account_id, amount) => {
    const result = await client.query(
        `INSERT INTO transactions (idempotency_key, account_id, amount)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [idempotency_key, account_id, amount]
    );
    return result.rows[0];
};

module.exports = { insert };
