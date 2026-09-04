const AppError = require("./AppError");

class ValidationError extends AppError {
    constructor(zodError) {
        super("validation error", 400);
        this.errors = zodError.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
        }));
    }
}

module.exports = ValidationError;
