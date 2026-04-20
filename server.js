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

// Cloudflare R2 Setup
const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL; 

// Folders
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const upload = multer({ dest: 'uploads/' });
app.use(express.static(publicDir));

async function uploadToR2(localFolder, r2Path) {
    const files = fs.readdirSync(localFolder);
    for (const file of files) {
        const filePath = path.join(localFolder, file);
        const fileContent = fs.readFileSync(filePath);
        const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T';

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${r2Path}/${file}`,
            Body: fileContent,
            ContentType: contentType
        }));
    }
}

// Video Upload & Smart Compression API
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send('No video uploaded');

    const videoPath = req.file.path;
    const folderName = req.file.filename; 
    const hlsFolder = path.join(outputDir, folderName);
    fs.mkdirSync(hlsFolder, { recursive: true });
    const m3u8Path = path.join(hlsFolder, 'playlist.m3u8');

    const seriesName = req.body.series ? req.body.series.replace(/[^a-zA-Z0-9]/g, "_") : 'Unknown_Series';
    const episodeNum = req.body.episode ? `Ep_${req.body.episode}` : 'Ep_0';
    const quality = req.body.quality || '720p'; // Default to 720p
    const r2FolderPath = `${seriesName}/${episodeNum}`; 

    // --- Compression Logic ---
    let scaleOpt = '-2:720'; // Default 720p resolution
    let bitrateOpt = '2500k'; // Default moderate bitrate

    if (quality === '1080p') {
        scaleOpt = '-2:1080';
        bitrateOpt = '4500k'; // High quality, larger file
    } else if (quality === '480p') {
        scaleOpt = '-2:480';
        bitrateOpt = '1000k'; // Highly compressed, small file
    }

    console.log(`Processing: ${seriesName} - ${episodeNum} | Quality: ${quality}`);

    ffmpeg(videoPath)
        .addOptions([
            '-profile:v baseline', 
            '-level 3.0', 
            '-start_number 0',
            '-hls_time 10', 
            '-hls_list_size 0', 
            '-f hls',
            // Applying Compression Settings here:
            `-vf scale=${scaleOpt}`, 
            `-b:v ${bitrateOpt}`,
            '-c:a aac', // Ensure audio is compatible
            '-b:a 128k' // Compress audio slightly for web
        ])
        .output(m3u8Path)
        .on('end', async () => {
            console.log('Conversion Done! Uploading to R2...');
            try {
                await uploadToR2(hlsFolder, r2FolderPath);
                
                // Cleanup local files
                if(fs.existsSync(videoPath)) fs.unlinkSync(videoPath); 
                if(fs.existsSync(hlsFolder)) fs.rmSync(hlsFolder, { recursive: true, force: true }); 
                
                const finalStreamUrl = `${PUBLIC_URL}/${r2FolderPath}/playlist.m3u8`;
                
                // --- FFmpeg Command String banana (UI mein dikhane ke liye) ---
                const ffmpegLog = `ffmpeg -i "${req.file.originalname}" -profile:v baseline -level 3.0 -hls_time 10 -vf scale=${scaleOpt} -b:v ${bitrateOpt} -c:a aac -b:a 128k playlist.m3u8`;

                res.json({
                    status: 'Success',
                    message: 'Video Compressed, Converted & Saved to R2!',
                    stream_url: finalStreamUrl,
                    ffmpeg_cmd: ffmpegLog
                });
            } catch (error) {
                console.error('R2 Upload Error:', error);
                res.status(500).json({ status: 'Error', message: 'Upload to R2 Failed' });
            }
        })
        .on('error', (err) => {
            console.error('FFmpeg Processing Error:', err.message);
            res.status(500).json({ status: 'Error', message: 'FFmpeg Processing Failed' });
            
            // File cleanup on error
            if(fs.existsSync(videoPath)) fs.unlinkSync(videoPath); 
            if(fs.existsSync(hlsFolder)) fs.rmSync(hlsFolder, { recursive: true, force: true });
        })
        .run(); // <--- IMPORTNAT: Ye line missing thi, ye hi actual command run karti hai
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
