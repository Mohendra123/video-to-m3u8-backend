const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cloudflare R2 Setup (Railway Variables से Data लेगा)
const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL; // आपका R2 Public Link

// Folders
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const upload = multer({ dest: 'uploads/' });
app.use(express.static(publicDir));

// R2 में फोल्डर अपलोड करने का फंक्शन
async function uploadToR2(localFolder, r2Path) {
    const files = fs.readdirSync(localFolder);
    for (const file of files) {
        const filePath = path.join(localFolder, file);
        const fileContent = fs.readFileSync(filePath);
        
        // Content-Type सेट करना जरूरी है ताकि ब्राउज़र उसे डाउनलोड करने के बजाय Play करे
        const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T';

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${r2Path}/${file}`,
            Body: fileContent,
            ContentType: contentType
        }));
    }
}

// Video Upload API
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send('No video uploaded');

    const videoPath = req.file.path;
    const folderName = req.file.filename; 
    const hlsFolder = path.join(outputDir, folderName);
    fs.mkdirSync(hlsFolder, { recursive: true });
    
    const m3u8Path = path.join(hlsFolder, 'playlist.m3u8');

    // UI से आया डेटा (Series, Episode)
    const seriesName = req.body.series ? req.body.series.replace(/[^a-zA-Z0-9]/g, "_") : 'Unknown_Series';
    const episodeNum = req.body.episode ? `Ep_${req.body.episode}` : 'Ep_0';
    const r2FolderPath = `${seriesName}/${episodeNum}`; // Cloudflare में ऐसा फोल्डर बनेगा

    console.log(`Processing: ${seriesName} - ${episodeNum}`);

    ffmpeg(videoPath)
        .addOptions([
            '-profile:v baseline', '-level 3.0', '-start_number 0',
            '-hls_time 10', '-hls_list_size 0', '-f hls'
        ])
        .output(m3u8Path)
        .on('end', async () => {
            console.log('FFmpeg Conversion Done! Uploading to R2...');
            try {
                // 1. R2 में अपलोड करें
                await uploadToR2(hlsFolder, r2FolderPath);
                console.log('Successfully uploaded to R2!');

                // 2. Railway से डिलीट करें (Auto-Delete)
                fs.unlinkSync(videoPath); // ओरिजिनल MP4 डिलीट
                fs.rmSync(hlsFolder, { recursive: true, force: true }); // M3U8 फोल्डर डिलीट
                console.log('Local files deleted from Railway.');

                // 3. Frontend को R2 का फाइनल लिंक भेजें
                const finalStreamUrl = `${PUBLIC_URL}/${r2FolderPath}/playlist.m3u8`;
                
                res.json({
                    status: 'Success',
                    message: 'Video Converted and Saved to Cloudflare R2!',
                    stream_url: finalStreamUrl
                });

            } catch (error) {
                console.error('R2 Upload Error:', error);
                res.status(500).json({ status: 'Error', message: 'Upload to R2 Failed' });
            }
        })
        .on('error', (err) => {
            console.error('FFmpeg Error:', err);
            res.status(500).json({ status: 'Error', message: err.message });
        })
        .run();
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
