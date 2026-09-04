const AppError = require("./AppError");

class SenderDeactivatedError extends AppError {
    constructor() {
        super("sender account is deactivated", 400);
    }
}

module.exports = SenderDeactivatedError;
