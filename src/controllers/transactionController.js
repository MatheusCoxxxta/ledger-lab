const { send: sendUsecase } = require("../usecases/send");

const send = async (req, res) => {
    const body = req.body;

    if (body.amount == null || body.amount <= 0) return res.status(400).json({ message: "amount must be positive" });

    await sendUsecase(body);

    return res.json();
};

module.exports = { send };
