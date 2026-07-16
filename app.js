require('dotenv').config()
require('./config/mongoose.connection')

const express = require('express')
const app = express()
const cookieParser = require('cookie-parser')
const path = require('path')
const indexRoute = require('./routes/index.route')
const authRoute = require('./routes/auth.route')
const cohortRoute = require('./routes/cohort.protected.route')
const adminRoute = require('./routes/admin.protected.route');
const session = require('express-session')
const flash = require('connect-flash')

app.use((req, res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
        req.url = req.url.replace('/.netlify/functions/api', '');
    }
    next();
});

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false
}))
app.use(flash())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.set('view engine', 'ejs')
app.use(express.static(path.join(__dirname, "public")))
app.use(cookieParser())
app.use((req, res, next) => {
    res.locals.error = req.flash('error')
    next()
})

app.use('/', indexRoute)
app.use('/auth', authRoute)
app.use('/cohort', cohortRoute)
app.use('/admin', adminRoute);

app.listen(3000, (req, res) => {
    console.log('Server running !')
})

// Keep your existing app.listen code, but add the export line:
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Running locally...'));
}

module.exports = app; // 👈 CRITICAL: This allows Netlify to read your app
