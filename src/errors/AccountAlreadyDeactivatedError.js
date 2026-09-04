const AppError = require("./AppError");

class AccountAlreadyDeactivatedError extends AppError {
    constructor() {
        super("account already deactivated", 409);
    }
}

module.exports = AccountAlreadyDeactivatedError;
