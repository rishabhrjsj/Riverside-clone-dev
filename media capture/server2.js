const express = require("express");
const multer = require("multer");
const cors = require("cors");
const AWS = require('aws-sdk');
const path = require('path'); // For path.join
const app = express();
app.use(cors()); // Enable CORS for all routes

const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- S3 Configuration (as you had it) ---
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});
const s3 = new AWS.S3();
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// --- Helper function to pad chunk index ---
function padChunkIndex(index, length = 5) { // Default to 5 digits, adjust as needed
    return String(index).padStart(length, '0');
}

// This array will now correctly store Buffer objects
let joinChunks = [];

app.post("/upload-chunk", upload.single("videoChunk"), (req, res) => {
  const { roomId, recordingId, chunkIndex, userId, timestamp } = req.body;

  console.log("Received data:", {
    roomId,
    recordingId,
    chunkIndex,
    userId,
    timestamp,
  });
  console.log("File info:", req.file?.originalname);

  // Check if a file was actually uploaded for this chunk
  if (req.file && req.file.buffer) {
    // --- FIX IS HERE: Push req.file.buffer instead of req.file ---
    joinChunks.push(req.file.buffer);
    console.log(`Length of video chunks array: ${joinChunks.length}`);
    res.status(200).json({ message: "Chunk received successfully" });
  } else {
    // Handle cases where a file chunk is expected but not received (e.g., for 'isLastChunk' signal)
    // If 'isLastChunk' is sent without a file, you might handle it here for job triggering
    const isLastChunk = req.body.isLastChunk === "true";
    if (isLastChunk) {
      console.log(
        `Received 'isLastChunk' signal for recordingId: ${recordingId}`
      );
      // In a real application, this is where you'd trigger the FFmpeg reassembly job
      // For now, just acknowledge.
      
      res.status(200).json({ message: "End of recording signal received." });
    } else {
      console.warn("Received a chunk request but no file buffer was present.");
      res.status(400).json({ message: "No video chunk file received." });
    }
    
  }
});

app.get("/send-blob", (req, res) => {
  // Check if there are any chunks before concatenating to avoid errors on empty array
  if (joinChunks.length === 0) {
    return res
      .status(404)
      .json({ message: "No video chunks have been uploaded yet." });
  }

  // Join Buffers into one
  const finalBuffer = Buffer.concat(joinChunks);

  res.setHeader("Content-Type", "video/webm");
  res.setHeader("Content-Length", finalBuffer.length);
  res.send(finalBuffer);

  // Optional: Clear chunks after sending for a new test recording
  // In a real application, you'd clear specific chunks after they're processed and stored
  joinChunks = [];
  // console.log("Chunks cleared after sending blob.");
});

//upload chunks to s3 cloud 
async function uploadChunkToS3(chunkBuffer, mimeType, roomId, recordingId, chunkIndex) {
    // Construct the S3 Key (path and filename in the bucket)
    // Use paddedChunkIndex to ensure correct sorting later
    const s3Key = path.join(
        'recordings',
        roomId,
        recordingId,
        'chunks',
        `chunk_${padChunkIndex(chunkIndex)}.webm` // Assuming .webm for video chunks
    );

    const uploadParams = {
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: chunkBuffer,
        ContentType: mimeType,
        // Optional: Add more S3 specific configurations like ACL, ServerSideEncryption, etc.
        // ACL: 'private', // Make objects private by default
    };

    try {
        const data = await s3.upload(uploadParams).promise(); // `promise()` makes it awaitable
        console.log(`Successfully uploaded chunk ${chunkIndex} for recording ${recordingId} to S3: ${data.Location}`);
        return data; // Returns information about the uploaded object (e.g., its URL)
    } catch (error) {
        console.error(`Error uploading chunk ${chunkIndex} for recording ${recordingId} to S3:`, error);
        throw new Error(`S3 Upload Failed: ${error.message}`); // Re-throw to be caught by the calling function
    }
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
