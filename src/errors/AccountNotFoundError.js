const AppError = require("./AppError");

class AccountNotFoundError extends AppError {
    constructor() {
        super("account not found", 404);
    }
}

module.exports = AccountNotFoundError;
