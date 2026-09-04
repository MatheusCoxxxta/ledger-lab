const pool = require("../db");
const InvalidAmountError = require("../errors/InvalidAmountError");
const SenderNotFoundError = require("../errors/SenderNotFoundError");
const SenderDeactivatedError = require("../errors/SenderDeactivatedError");
const InsufficientBalanceError = require("../errors/InsufficientBalanceError");
const ReceiverNotFoundError = require("../errors/ReceiverNotFoundError");
const ReceiverDeactivatedError = require("../errors/ReceiverDeactivatedError");
const accountRepository = require("../repositories/accountRepository");
const transactionRepository = require("../repositories/transactionRepository");
const entryRepository = require("../repositories/entryRepository");

const send = async ({ sender_id, receiver_id, amount, idempotency_key }) => {
    if (amount == null || amount <= 0) throw new InvalidAmountError();

    const client = await pool.connect();
    try {
        const sender = await accountRepository.findById(client, sender_id);
        if (!sender) throw new SenderNotFoundError();
        if (sender.deactivated_at) throw new SenderDeactivatedError();
        if (sender.balance <= 0 || sender.balance - amount < 0) throw new InsufficientBalanceError();

        const receiver = await accountRepository.findById(client, receiver_id);
        if (!receiver) throw new ReceiverNotFoundError();
        if (receiver.deactivated_at) throw new ReceiverDeactivatedError();

        await client.query("BEGIN");
        try {
            const lockedSender = await accountRepository.findByIdForUpdate(client, sender_id);
            if (lockedSender.deactivated_at) throw new SenderDeactivatedError();
            if (lockedSender.balance <= 0 || lockedSender.balance - amount < 0) throw new InsufficientBalanceError();

            const lockedReceiver = await accountRepository.findByIdForUpdate(client, receiver_id);
            if (lockedReceiver.deactivated_at) throw new ReceiverDeactivatedError();

            const transaction = await transactionRepository.insert(client, idempotency_key, sender_id, amount);
            await entryRepository.insert(client, lockedSender.id, transaction.id, "debit", amount);
            await entryRepository.insert(client, lockedReceiver.id, transaction.id, "credit", amount);
            await accountRepository.updateBalance(client, sender_id, "debit", amount);
            await accountRepository.updateBalance(client, receiver_id, "credit", amount);

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    } finally {
        client.release();
    }
};

module.exports = { send };
