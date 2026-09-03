const { createAccount: createAccountUsecase } = require("../usecases/createAccount");
const { deactivateAccount: deactivateAccountUsecase } = require("../usecases/deactivateAccount");

const createAccount = async (req, res) => {
    const result = await createAccountUsecase(req.body);
    if (result.error) return res.status(400).json({ message: result.error });
    return res.status(201).json(result.account);
};

const deactivateAccount = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await deactivateAccountUsecase(id);
        if (result.notFound) return res.status(404).json({ message: "account not found" });
        if (result.alreadyDeactivated) return res.status(409).json({ message: "account already deactivated" });
        return res.json(result.account);
    } catch (error) {
        if (error.code === "22P02") return res.status(400).json({ message: "invalid account id" });
        throw error;
    }
};

module.exports = { createAccount, deactivateAccount };
