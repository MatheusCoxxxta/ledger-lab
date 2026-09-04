const insert = async (client, account_id, transaction_id, direction, amount) => {
    const result = await client.query(
        `INSERT INTO entries (account_id, transaction_id, direction, amount)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [account_id, transaction_id, direction, amount]
    );
    return result.rows[0];
};

module.exports = { insert };
