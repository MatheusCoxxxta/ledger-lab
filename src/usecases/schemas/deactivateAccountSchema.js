const { z } = require("zod");

const deactivateAccountSchema = z.object({
    id: z.string().uuid(),
});

module.exports = { deactivateAccountSchema };
