const AppError = require("./AppError");

class SenderNotFoundError extends AppError {
    constructor() {
        super("sender account not found", 400);
    }
}

module.exports = SenderNotFoundError;
