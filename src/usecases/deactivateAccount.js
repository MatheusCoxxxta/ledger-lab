const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const AccountNotFoundError = require("../errors/AccountNotFoundError");
const AccountAlreadyDeactivatedError = require("../errors/AccountAlreadyDeactivatedError");

const deactivateAccount = async (id) => {
    const client = await pool.connect();
    try {
        const account = await accountRepository.deactivate(client, id);
        if (account) return account;

        const existing = await accountRepository.findById(client, id);
        if (!existing) throw new AccountNotFoundError();
        throw new AccountAlreadyDeactivatedError();
    } finally {
        client.release();
    }
};

module.exports = { deactivateAccount };
