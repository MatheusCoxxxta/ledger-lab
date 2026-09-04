const pool = require("../db");
const SenderNotFoundError = require("../errors/SenderNotFoundError");
const SenderDeactivatedError = require("../errors/SenderDeactivatedError");
const InsufficientBalanceError = require("../errors/InsufficientBalanceError");
const ReceiverNotFoundError = require("../errors/ReceiverNotFoundError");
const ReceiverDeactivatedError = require("../errors/ReceiverDeactivatedError");
const accountRepository = require("../repositories/accountRepository");
const transactionRepository = require("../repositories/transactionRepository");
const entryRepository = require("../repositories/entryRepository");
const { sendSchema } = require("./schemas/sendSchema");

const send = async ({ sender_id, receiver_id, amount, idempotency_key }) => {
    const data = sendSchema.parse({ sender_id, receiver_id, amount, idempotency_key });

    const client = await pool.connect();
    try {
        const sender = await accountRepository.findById(data.sender_id, client);
        if (!sender) throw new SenderNotFoundError();
        if (sender.deactivated_at) throw new SenderDeactivatedError();
        if (sender.balance <= 0 || sender.balance - data.amount < 0) throw new InsufficientBalanceError();

        const receiver = await accountRepository.findById(data.receiver_id, client);
        if (!receiver) throw new ReceiverNotFoundError();
        if (receiver.deactivated_at) throw new ReceiverDeactivatedError();

        await client.query("BEGIN");
        try {
            const lockedSender = await accountRepository.findByIdForUpdate(data.sender_id, client);
            if (lockedSender.deactivated_at) throw new SenderDeactivatedError();
            if (lockedSender.balance <= 0 || lockedSender.balance - data.amount < 0) throw new InsufficientBalanceError();

            const lockedReceiver = await accountRepository.findByIdForUpdate(data.receiver_id, client);
            if (lockedReceiver.deactivated_at) throw new ReceiverDeactivatedError();

            const transaction = await transactionRepository.insert(data.idempotency_key, data.sender_id, data.amount, client);
            await entryRepository.insert(lockedSender.id, transaction.id, "debit", data.amount, client);
            await entryRepository.insert(lockedReceiver.id, transaction.id, "credit", data.amount, client);
            await accountRepository.updateBalance(data.sender_id, "debit", data.amount, client);
            await accountRepository.updateBalance(data.receiver_id, "credit", data.amount, client);

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
