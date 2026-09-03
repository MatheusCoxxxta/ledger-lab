const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DATABASE_HOST || "localhost",
  port: process.env.DATABASE_PORT,
  user: process.env.DATABASE_USER || "postgres",
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

module.exports = pool;
