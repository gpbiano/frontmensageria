module.exports = {
  apps: [
    {
      name: "gplabs-api",
      script: "src/index.js",
      cwd: "/home/ubuntu/apps/frontmensageria/backend",
      env_production: {
        NODE_ENV: "production"
      }
    }
  ]
};
