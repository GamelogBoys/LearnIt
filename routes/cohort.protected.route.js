const express = require('express')
const router = express.Router()
const isLoggedIn = require('../middleware/is.loggedIn')
const videoModel = require('../models/video.model')
const userModel = require('../models/user.model')
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { GridFsStorage } = require('multer-gridfs-storage');
const mongoose = require('mongoose')

router.get('/file/:filename', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        
        // 1. Target the exact GridFS bucket name we uploaded files into ('uploads')
        const bucket = new mongoose.mongo.GridFSBucket(db, {
            bucketName: 'uploads'
        });

        // 2. Locate the file metadata document using the custom filename parameter
        const files = await bucket.find({ filename: req.params.filename }).toArray();
        
        if (!files || files.length === 0) {
            return res.status(404).json({ error: 'File completely missing from GridFS arrays.' });
        }

        const file = files[0];

        // 3. Set standard HTTP Streaming headers so browsers know how to process it
        // Determines if it should be treated as image/png, video/mp4, etc.
        res.set('Content-Type', file.contentType || 'application/octet-stream');
        res.set('Accept-Ranges', 'bytes');

        // 4. Open the data download channel stream and pipe it directly out to the server response
        const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
        
        downloadStream.pipe(res);

        // Error boundary safe hook to close broken client pipes cleanly
        downloadStream.on('error', (err) => {
            console.error("Stream pipe broke mid-flight:", err.message);
            res.sendStatus(500);
        });

    } catch (err) {
        console.error("GridFS Retrieval Stream Broken:", err.message);
        res.status(500).json({ error: 'Internal system engine streaming error.' });
    }
});

router.get('/', isLoggedIn, async (req, res) => {
    try {
        let dbQuery = {};
        const { search, tag } = req.query;

        // Apply search input query condition
        if (search) {
            dbQuery.title = { $regex: search.trim(), $options: 'i' };
        }

        // Apply category tag query condition
        if (tag && tag !== 'all') {
            dbQuery.tag = { $regex: `^${tag.trim()}$`, $options: 'i' };
        }

        // Fetch videos match criteria
        const videos = await videoModel.find(dbQuery);

        // Render the page passing the video dataset array along with session parameters
        res.render("protected/cohort.user.ejs", { 
            videos, 
            user: req.user, 
            currentTag: tag || 'all', 
            searchQuery: search || '' 
        });
    } catch (err) {
        console.error(err.message);
        req.flash('error', 'Error reading video database platform catalogs.');
        res.redirect('/');
    }
});

// Asynchronous background endpoint processing for tracking views updates
router.post('/video/:id/view', isLoggedIn, async (req, res) => {
    try {
        await videoModel.findByIdAndUpdate(req.params.id, {
            $addToSet: { views: req.user._id } // Prevents redundant duplicate array inserts per single active session user
        });
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed logging tracking metrics.' });
    }
});

// Render the YouTube-style Video Watch Page
router.get('/watch/:id', isLoggedIn, async (req, res) => {
    try {
        const currentVideo = await videoModel.findById(req.params.id);
        
        if (!currentVideo) {
            req.flash('error', 'Video asset not found.');
            return res.redirect('/cohort');
        }

        // Fetch up to 6 other videos for the sidebar recommendations (excluding the current one)
        const suggestions = await videoModel.find({ _id: { $ne: currentVideo._id } }).limit(6);

        res.render("protected/watch.ejs", {
            video: currentVideo,
            suggestions,
            user: req.user
        });
    } catch (err) {
        console.error(err.message);
        req.flash('error', 'Error loading video player interface.');
        res.redirect('/cohort');
    }
});

// Toggle Like Endpoint Logic
router.post('/video/:id/like', isLoggedIn, async (req, res) => {
    try {
        const video = await videoModel.findById(req.params.id);
        if (!video) return res.status(404).json({ error: 'Video not found' });

        const userIndex = video.likes.indexOf(req.user._id);
        let isLiked = false;

        if (userIndex === -1) {
            video.likes.push(req.user._id); // Add like
            isLiked = true;
        } else {
            video.likes.splice(userIndex, 1); // Unlike if double-toggled
        }

        await video.save();
        res.status(200).json({ success: true, likesCount: video.likes.length, isLiked });
    } catch (err) {
        res.status(500).json({ error: 'Failed updating like counter states.' });
    }
});

const mongoStorage = new GridFsStorage({
    url: process.env.MONGO_URI, // 👈 Uses your main database connection URL
    options: { useNewUrlParser: true, useUnifiedTopology: true },
    file: (req, file) => {
        return new Promise((resolve, reject) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
            
            // File configuration structure stored in the database
            const fileInfo = {
                filename: filename,
                bucketName: 'uploads' // 👈 GridFS collection name (will create 'uploads.files' and 'uploads.chunks')
            };
            resolve(fileInfo);
        });
    }
});
    
const uploadDp = multer({ storage: mongoStorage });

// 1. Render Settings View Layout
router.get('/settings', isLoggedIn, (req, res) => {
    res.render('protected/settings.ejs', { user: req.user });
});

// 2. Update Profile Info Route (Name & Profile Picture)
router.post('/settings/update-profile', isLoggedIn, uploadDp.single('image'), async (req, res) => {
    try {
        const { fullname } = req.body;
        const updateData = { fullname };

        // If a new profile photo file was uploaded
        if (req.file) {
            updateData.image = `/images/uploads/${req.file.filename}`;
        }

        await userModel.findByIdAndUpdate(req.user._id, updateData);
        req.flash('success', 'Profile updated successfully.');
        res.redirect('/cohort/settings');
    } catch (err) {
        console.error(err.message);
        req.flash('error', 'Failed to update profile information.');
        res.redirect('/cohort/settings');
    }
});

// 3. Change Password Route
router.post('/settings/change-password', isLoggedIn, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await userModel.findById(req.user._id);

        // Verify current password match
        bcrypt.compare(currentPassword, user.password, async (err, isMatch) => {
            if (!isMatch) {
                req.flash('error', 'Current password details are incorrect.');
                return res.redirect('/cohort/settings');
            }

            // Encrypt and save new password
            const salt = await bcrypt.genSalt(parseInt(process.env.SALT) || 10);
            const hashedNewPassword = await bcrypt.hash(newPassword, salt);
            
            user.password = hashedNewPassword;
            await user.save();

            req.flash('success', 'Password updated successfully!');
            res.redirect('/cohort/settings');
        });
    } catch (err) {
        console.error(err.message);
        req.flash('error', 'Failed changing password values.');
        res.redirect('/cohort/settings');
    }
});

// 4. Logout Route
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/');
});

module.exports = router;