const AppError = require("./AppError");

class DuplicateTransactionError extends AppError {
    constructor() {
        super("transaction already processed", 400);
    }
}

module.exports = DuplicateTransactionError;
