const { createAccount: createAccountUsecase } = require("../usecases/createAccount");
const { deactivateAccount: deactivateAccountUsecase } = require("../usecases/deactivateAccount");

const createAccount = async (req, res) => {
    const result = await createAccountUsecase(req.body);
    return res.status(201).json(result.account);
};

const deactivateAccount = async (req, res) => {
    const { id } = req.params;
    const account = await deactivateAccountUsecase(id);
    return res.json(account);
};

module.exports = { createAccount, deactivateAccount };
