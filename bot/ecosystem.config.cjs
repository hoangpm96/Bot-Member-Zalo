const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

function fromBotDir(value, fallback) {
  return path.resolve(__dirname, value || fallback);
}

const sessionDir = fromBotDir(process.env.SESSION_DIR, "data");
const dbPath = fromBotDir(process.env.SQLITE_DB_PATH, "data/bot.db");
const vipPath = fromBotDir(process.env.VIP_LIST_PATH, "data/vip-list.json");

module.exports = {
  apps: [
    {
      name: "zalo-bot",
      script: "dist/index.js",
      args: "start",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "zalo-web",
      script: "npm",
      // -H 127.0.0.1: chỉ nghe localhost. Web ra ngoài qua Nginx reverse proxy,
      // không phơi PORT thẳng ra Internet (tránh bỏ qua Basic Auth ở tầng Nginx).
      args: "start -- -H 127.0.0.1",
      cwd: path.resolve(__dirname, "../web"),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: process.env.WEB_PORT || "3000",
        // Web đọc cùng runtime data với bot, không phụ thuộc cwd của Next.js.
        WEB_QR_DIR: sessionDir,
        WEB_DB_PATH: dbPath,
        WEB_VIP_PATH: vipPath,
      },
    },
  ],
};
