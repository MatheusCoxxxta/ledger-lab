require("dotenv").config();

const express = require("express");
const healthController = require("./src/controllers/healthController");
const accountController = require("./src/controllers/accountController");
const transactionController = require("./src/controllers/transactionController");
const AppError = require("./src/errors/AppError");

const app = express();

app.use(express.json());

app.get("/health", healthController.health);
app.post("/accounts", accountController.createAccount);
app.patch("/accounts/:id/deactivate", accountController.deactivateAccount);
app.post("/send", transactionController.send);

app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on port ${port}`);
});
