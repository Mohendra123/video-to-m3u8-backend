const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public'); // नया Public फोल्डर

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const upload = multer({ dest: 'uploads/' });

// 1. Static Files Serve करना
// यह लाइन आपके नए MoGo FM UI को मेन URL पर दिखाएगी
app.use(express.static(publicDir)); 
// यह लाइन कन्वर्ट हुई .m3u8 फाइल्स को स्ट्रीम करने के लिए है
app.use('/stream', express.static(outputDir));

// 2. Video Upload & Conversion API
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send('No video uploaded');

    const videoPath = req.file.path;
    const folderName = req.file.filename; 
    const hlsFolder = path.join(outputDir, folderName);
    
    fs.mkdirSync(hlsFolder, { recursive: true });
    const m3u8Path = path.join(hlsFolder, 'playlist.m3u8');

    console.log(`Processing video: ${folderName}`);

    ffmpeg(videoPath)
        .addOptions([
            '-profile:v baseline',
            '-level 3.0',
            '-start_number 0',
            '-hls_time 10',
            '-hls_list_size 0',
            '-f hls'
        ])
        .output(m3u8Path)
        .on('end', () => {
            console.log('Conversion Successful!');
            res.json({
                status: 'Success',
                message: 'Video converted to .m3u8',
                stream_url: `/stream/${folderName}/playlist.m3u8` 
            });
            
            // Clean up: Delete the original mp4/mov file to save space
            try { fs.unlinkSync(videoPath); } catch(e) { console.error('Cleanup error', e); }
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).json({ status: 'Error', message: err.message });
        })
        .run();
});

app.listen(PORT, () => {
    console.log(`MoGo FM Server running on port ${PORT}`);
});
