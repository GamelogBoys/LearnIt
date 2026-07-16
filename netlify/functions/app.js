const serverless = require('serverless-http');
const app = require('../../app'); // 👈 This imports your main app.js

// Wrap the Express app inside serverless-http
module.exports.handler = serverless(app);