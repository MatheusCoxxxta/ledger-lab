const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");

const validate = ({ name, currency, balance }) => {
    if (!name || name.trim() === "") return "name is required";
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return "currency must be a 3-letter string";
    if (typeof balance !== "number" || balance < 0) return "balance must be a non-negative number";
    return null;
};

const createAccount = async ({ name, currency = "BRL", balance = 0 }) => {
    const validationError = validate({ name, currency, balance });
    if (validationError) return { error: validationError };

    const client = await pool.connect();
    try {
        const account = await accountRepository.insert(client, name.trim(), currency.toUpperCase(), balance);
        return { account };
    } finally {
        client.release();
    }
};

module.exports = { createAccount };
