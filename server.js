const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// फोल्डर बनाएँ (अगर नहीं हैं)
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// फाइल अपलोड सेटिंग
const upload = multer({ dest: 'uploads/' });

// टेस्ट रूट
app.get('/', (req, res) => {
    res.send('Video to .m3u8 Converter is Running!');
});

// वीडियो अपलोड और कन्वर्ट करने का रूट
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send('No video uploaded');

    const videoPath = req.file.path;
    const folderName = req.file.filename; // हर वीडियो के लिए अलग फोल्डर
    const hlsFolder = path.join(outputDir, folderName);
    
    fs.mkdirSync(hlsFolder, { recursive: true });
    const m3u8Path = path.join(hlsFolder, 'playlist.m3u8');

    console.log('Converting video to HLS...');

    ffmpeg(videoPath)
        .addOptions([
            '-profile:v baseline', // डिवाइस compatibility के लिए
            '-level 3.0',
            '-start_number 0',
            '-hls_time 10',        // 10 सेकंड के छोटे टुकड़े (ts files) बनाएगा
            '-hls_list_size 0',    // पूरी वीडियो का प्लेलिस्ट रखेगा
            '-f hls'
        ])
        .output(m3u8Path)
        .on('end', () => {
            console.log('Conversion Successful!');
            res.json({
                status: 'Success',
                message: 'Video converted to .m3u8',
                // यह URL आप प्लेयर में डालेंगे
                stream_url: `/stream/${folderName}/playlist.m3u8` 
            });
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).send('Conversion Failed: ' + err.message);
        })
        .run();
});

// .m3u8 और .ts फाइल्स को स्ट्रीम करने के लिए
app.use('/stream', express.static(outputDir));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
