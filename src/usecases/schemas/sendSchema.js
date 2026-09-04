const { z } = require("zod");

const sendSchema = z.object({
    sender_id: z.string().uuid(),
    receiver_id: z.string().uuid(),
    amount: z.number().positive(),
    idempotency_key: z.string().min(1),
});

module.exports = { sendSchema };
