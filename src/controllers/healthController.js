const pool = require("../db");

const health = async (_req, res) => {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", time: result.rows[0].now });
};

module.exports = { health };
