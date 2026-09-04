const { z } = require("zod");

const createAccountSchema = z.object({
    name: z.string().trim().min(1),
    currency: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .transform((v) => v.toUpperCase())
        .default("BRL"),
    balance: z.number().nonnegative().default(0),
});

module.exports = { createAccountSchema };
