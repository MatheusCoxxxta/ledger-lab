const AppError = require("./AppError");

class ReceiverNotFoundError extends AppError {
    constructor() {
        super("receiver account not found", 400);
    }
}

module.exports = ReceiverNotFoundError;
