module.exports = {
    apps: [
      {
        name: "aglis-operation-system",
        script: "app.js",
        watch: true,
        autorestart: true,
        restart_delay: 5000,
        env: {
          NODE_ENV: "production",
        },
      },
    ],
  };
  