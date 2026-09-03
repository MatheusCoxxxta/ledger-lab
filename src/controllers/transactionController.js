const { send: sendUsecase } = require("../usecases/send");

const errorMessages = {
    SENDER_NOT_FOUND: "sender account not found",
    SENDER_DEACTIVATED: "sender account is deactivated",
    INSUFFICIENT_BALANCE: "insuficient balance",
    RECEIVER_NOT_FOUND: "receiver account not found",
    RECEIVER_DEACTIVATED: "receiver account is deactivated",
};

const send = async (req, res) => {
    const body = req.body;

    if (body.amount == null || body.amount <= 0) return res.status(400).json({ message: "amount must be positive" });

    const result = await sendUsecase(body);

    if (result.duplicateKey) return res.status(400).json({ message: "transaction already processed" });
    if (result.error) return res.status(400).json({ message: errorMessages[result.error] });

    return res.json();
};

module.exports = { send };
