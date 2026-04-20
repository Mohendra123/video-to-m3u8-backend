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

// Cloudflare R2 Client Setup
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

// Folder structure creation
const dirs = ['uploads', 'output', 'public'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));

// Optimized R2 Upload
async function uploadToR2(localFolder, r2Path) {
    const files = fs.readdirSync(localFolder);
    const uploadPromises = files.map(async (file) => {
        const filePath = path.join(localFolder, file);
        const fileContent = fs.readFileSync(filePath);
        const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T';

        return s3.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${r2Path}/${file}`,
            Body: fileContent,
            ContentType: contentType
        }));
    });
    await Promise.all(uploadPromises);
}

// Upload & Process Route
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No video provided' });

    const videoPath = req.file.path;
    const folderName = req.file.filename; 
    const hlsFolder = path.join(__dirname, 'output', folderName);
    fs.mkdirSync(hlsFolder, { recursive: true });

    const seriesName = (req.body.series || 'Series').replace(/[^a-zA-Z0-9]/g, "_");
    const episodeNum = `Ep_${req.body.episode || '0'}`;
    const quality = req.body.quality || '720p';
    const r2FolderPath = `${seriesName}/${episodeNum}`; 

    // Compression profiles
    let scale = '-2:720', bitrate = '2500k';
    if (quality === '1080p') { scale = '-2:1080'; bitrate = '4500k'; }
    if (quality === '480p') { scale = '-2:480'; bitrate = '1000k'; }

    const ffmpegCommandUsed = `ffmpeg -i input.mp4 -vf scale=${scale} -b:v ${bitrate} -c:a aac -b:a 128k -f hls playlist.m3u8`;

    ffmpeg(videoPath)
        .addOptions([
            '-profile:v baseline', '-level 3.0', '-start_number 0',
            '-hls_time 10', '-hls_list_size 0', '-f hls',
            `-vf scale=${scale}`, `-b:v ${bitrate}`,
            '-c:a aac', '-b:a 128k'
        ])
        .output(path.join(hlsFolder, 'playlist.m3u8'))
        .on('end', async () => {
            try {
                await uploadToR2(hlsFolder, r2FolderPath);
                // Clean up files
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                fs.rmSync(hlsFolder, { recursive: true, force: true });

                res.json({
                    status: 'Success',
                    stream_url: `${PUBLIC_URL}/${r2FolderPath}/playlist.m3u8`,
                    ffmpeg_cmd: ffmpegCommandUsed
                });
            } catch (err) {
                res.status(500).json({ status: 'Error', message: 'R2 Upload Failed' });
            }
        })
        .on('error', (err) => {
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            res.status(500).json({ status: 'Error', message: err.message });
        })
        .run();
});

app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
