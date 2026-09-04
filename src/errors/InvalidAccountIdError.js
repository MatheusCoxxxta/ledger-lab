const AppError = require("./AppError");

class InvalidAccountIdError extends AppError {
    constructor() {
        super("invalid account id", 400);
    }
}

module.exports = InvalidAccountIdError;
