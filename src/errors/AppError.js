class AppError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
