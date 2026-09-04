const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const AccountNotFoundError = require("../errors/AccountNotFoundError");
const AccountAlreadyDeactivatedError = require("../errors/AccountAlreadyDeactivatedError");
const { deactivateAccountSchema } = require("./schemas/deactivateAccountSchema");

const deactivateAccount = async (id) => {
    const { id: validId } = deactivateAccountSchema.parse({ id });

    const client = await pool.connect();
    try {
        const account = await accountRepository.deactivate(client, validId);
        if (account) return account;

        const existing = await accountRepository.findById(client, validId);
        if (!existing) throw new AccountNotFoundError();
        throw new AccountAlreadyDeactivatedError();
    } finally {
        client.release();
    }
};

module.exports = { deactivateAccount };
