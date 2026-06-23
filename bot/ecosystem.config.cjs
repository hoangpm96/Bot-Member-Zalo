const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const sessionDir = path.resolve(__dirname, process.env.SESSION_DIR || "data");

module.exports = {
  apps: [
    {
      name: "zalo-bot",
      script: "npm",
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
      args: "start",
      cwd: path.resolve(__dirname, "../web"),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        // Web đọc QR/status trực tiếp từ runtime data của bot.
        // Dùng đường dẫn tuyệt đối để không phụ thuộc cwd hay nơi gọi PM2.
        WEB_QR_DIR: sessionDir,
      },
    },
  ],
};
