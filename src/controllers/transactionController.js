const { send: sendUsecase } = require("../usecases/send");

const send = async (req, res) => {
    const body = req.body;

    await sendUsecase(body);

    return res.json();
};

module.exports = { send };
