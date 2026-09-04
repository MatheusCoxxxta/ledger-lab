const AppError = require("./AppError");

class InsufficientBalanceError extends AppError {
    constructor() {
        super("insuficient balance", 400);
    }
}

module.exports = InsufficientBalanceError;
