const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const transactionRepository = require("../repositories/transactionRepository");
const entryRepository = require("../repositories/entryRepository");

const send = async ({ sender_id, receiver_id, amount, idempotency_key }) => {
    const client = await pool.connect();
    try {
        const sender = await accountRepository.findById(client, sender_id);
        if (!sender) return { error: "SENDER_NOT_FOUND" };
        if (sender.deactivated_at) return { error: "SENDER_DEACTIVATED" };
        if (sender.balance <= 0 || sender.balance - amount < 0) return { error: "INSUFFICIENT_BALANCE" };

        const receiver = await accountRepository.findById(client, receiver_id);
        if (!receiver) return { error: "RECEIVER_NOT_FOUND" };
        if (receiver.deactivated_at) return { error: "RECEIVER_DEACTIVATED" };

        await client.query("BEGIN");

        const lockedSender = await accountRepository.findByIdForUpdate(client, sender_id);
        if (lockedSender.deactivated_at) {
            await client.query("ROLLBACK");
            return { error: "SENDER_DEACTIVATED" };
        }
        if (lockedSender.balance <= 0 || lockedSender.balance - amount < 0) {
            await client.query("ROLLBACK");
            return { error: "INSUFFICIENT_BALANCE" };
        }

        const lockedReceiver = await accountRepository.findByIdForUpdate(client, receiver_id);
        if (lockedReceiver.deactivated_at) {
            await client.query("ROLLBACK");
            return { error: "RECEIVER_DEACTIVATED" };
        }

        const transaction = await transactionRepository.insert(client, idempotency_key, sender_id, amount);
        await entryRepository.insert(client, lockedSender.id, transaction.id, "debit", amount);
        await entryRepository.insert(client, lockedReceiver.id, transaction.id, "credit", amount);
        await accountRepository.updateBalance(client, sender_id, "debit", amount);
        await accountRepository.updateBalance(client, receiver_id, "credit", amount);

        await client.query("COMMIT");
        return {};
    } catch (error) {
        if (error.code === "23505" && error.constraint === "transactions_idempotency_key_key") {
            await client.query("ROLLBACK");
            return { duplicateKey: true };
        }
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { send };
