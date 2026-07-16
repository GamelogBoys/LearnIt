const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { GridFsStorage } = require('multer-gridfs-storage');
const isOwnerLoggedIn = require('../middleware/is.owner');
const videoModel = require('../models/video.model');
const { isAdmin } = require('../middleware/auth.middleware')
const mongoose = require('mongoose');

// Multer Storage Configuration
// 1. Use standard memory storage instead of the buggy gridfs engine
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 150 * 1024 * 1024 // 150 MB limit
    }
});

// Helper function to manually stream a memory buffer into a GridFS Bucket
const uploadToGridFS = (buffer, originalname, fieldname) => {
    return new Promise((resolve, reject) => {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, {
            bucketName: 'uploads'
        });

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = `${fieldname}-${uniqueSuffix}${path.extname(originalname)}`;

        // Create the open database stream channel
        const uploadStream = bucket.openUploadStream(filename);
        
        // Write the file buffer and close the stream channel cleanly
        uploadStream.end(buffer);

        uploadStream.on('finish', () => {
            resolve(filename); // Resolves the final generated filename string
        });

        uploadStream.on('error', (err) => {
            reject(err);
        });
    });
};

// 2. POST Route using pure memory storage + manual streaming hooks
router.post('/upload', isAdmin, upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'videoFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { title, tag } = req.body;
        
        if (!req.files || !req.files.thumbnail || !req.files.videoFile) {
            req.flash('error', 'Please upload both a thumbnail image and a video file.');
            return res.redirect('/admin/dashboard');
        }

        // Get file data out of memory storage buffers
        const thumbnailFile = req.files.thumbnail[0];
        const videoFile = req.files.videoFile[0];

        // Pipe both files safely using native promises (No out-of-order crashes!)
        const thumbnailFilename = await uploadToGridFS(thumbnailFile.buffer, thumbnailFile.originalname, 'thumbnail');
        const videoFilename = await uploadToGridFS(videoFile.buffer, videoFile.originalname, 'videoFile');

        // Create metadata document mapping strings into MongoDB collection
        await videoModel.create({
            title,
            tag,
            thumbnail: thumbnailFilename,
            videoPath: videoFilename
        });

        req.flash('success', 'Cohort media assets securely compiled to GridFS database arrays!');
        res.redirect('/cohort');
    } catch (err) {
        console.error("Manual GridFS Streaming Block Error:", err.message);
        req.flash('error', 'Failed to publish video asset.');
        res.redirect('/admin/dashboard');
    }
});

// Render Dashboard
router.get('/dashboard', isAdmin, (req, res) => {
    res.render('protected/admin.dashboard.ejs', { owner: req.user });
});

module.exports = router;