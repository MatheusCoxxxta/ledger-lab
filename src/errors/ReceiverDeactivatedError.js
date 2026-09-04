const AppError = require("./AppError");

class ReceiverDeactivatedError extends AppError {
    constructor() {
        super("receiver account is deactivated", 400);
    }
}

module.exports = ReceiverDeactivatedError;
