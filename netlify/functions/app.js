const serverless = require('serverless-http');
const app = require('../../app'); 

// This ensures Express strips the Netlify routing prefix completely
module.exports.handler = serverless(app, {
    provider: 'netlify'
});
