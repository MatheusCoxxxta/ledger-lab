const AppError = require("./AppError");

class InvalidAmountError extends AppError {
    constructor() {
        super("amount must be positive", 400);
    }
}

module.exports = InvalidAmountError;
