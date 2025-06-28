// --- Imports (Ensure these are at the top of your server.js file) ---
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const AWS = require("aws-sdk");
const path = require("path");
require("dotenv").config();

// --- NEW: BullMQ Imports ---
const { Queue } = require("bullmq");

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Multer Configuration ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- S3 Configuration ---
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION, // e.g., 'eu-north-1'
});
const s3 = new AWS.S3();
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// --- NEW: Redis Connection for BullMQ ---
// Connect to your Dockerized Redis instance
const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined, // If your Redis has a password
};
console.log(
  "Connecting BullMQ to Redis at:",
  redisConnection.host,
  ":",
  redisConnection.port
);

// Define a BullMQ Queue instance
const videoProcessingQueue = new Queue("videoProcessing", {
  connection: redisConnection,
});

// --- Helper function to pad chunk index ---
function padChunkIndex(index, length = 5) {
  return String(index).padStart(length, "0");
}

/**
 * Uploads a single video chunk to AWS S3.
 *
 * @param {Buffer} chunkBuffer - The binary data of the video chunk (req.file.buffer).
 * @param {string} mimeType - The MIME type of the chunk (req.file.mimetype).
 * @param {string} roomId - The master session ID.
 * @param {string} recordingId - The specific participant's recording track ID.
 * @param {number} chunkIndex - The sequential index of this chunk.
 * @returns {Promise<AWS.S3.ManagedUpload.SendData>} - A promise that resolves with S3 upload data on success.
 * @throws {Error} - Throws an error if the S3 upload fails.
 */
async function uploadChunkToS3(
  chunkBuffer,
  mimeType,
  roomId,
  recordingId,
  chunkIndex
) {
  // Construct the S3 Key using path.join, then replace all backslashes with forward slashes
  let s3Key = path.join(
    "recordings",
    roomId,
    recordingId,
    "chunks",
    `chunk_${padChunkIndex(chunkIndex)}.webm` // Assuming .webm for video chunks
  );
  s3Key = s3Key.replace(/\\/g, "/"); // <-- FIX: Replace backslashes with forward slashes for S3

  const uploadParams = {
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
    Body: chunkBuffer,
    ContentType: mimeType,
    // ACL: 'private', // Optional: Make objects private by default
  };

  try {
    const data = await s3.upload(uploadParams).promise();
    console.log(
      `Successfully uploaded chunk ${chunkIndex} for recording ${recordingId} to S3: ${data.Location}`
    );
    return data;
  } catch (error) {
    console.error(
      `Error uploading chunk ${chunkIndex} for recording ${recordingId} to S3:`,
      error
    );
    throw new Error(`S3 Upload Failed: ${error.message}`);
  }
}

// --- UPDATED: Function to trigger a background video reassembly job (now adds to queue) ---
async function triggerVideoReassemblyJob(jobDetails) {
  try {
    await videoProcessingQueue.add("processVideoJob", jobDetails, {
      removeOnComplete: true,
      removeOnFail: false,
      jobId: `process-${jobDetails.recordingId}`,
    });
    console.log(
      `[JOB QUEUE] Added job for recording track: ${jobDetails.recordingId} to queue.`
    );
  } catch (error) {
    console.error(
      `[JOB QUEUE] Failed to add job for recording track ${jobDetails.recordingId}:`,
      error
    );
  }
}

// --- Global variable to store the simulated S3 key of the last processed video ---
let lastProcessedVideoLocation = null;

// --- API Endpoint to Receive Chunks ---
app.post("/upload-chunk", upload.single("videoChunk"), async (req, res) => {
  const { roomId, recordingId, chunkIndex, userId, timestamp, isLastChunk } =
    req.body;
  const videoChunkFile = req.file;

  console.log("Received chunk data:", {
    roomId,
    recordingId,
    chunkIndex: chunkIndex,
    userId,
    timestamp,
    isLastChunk: isLastChunk === "true",
    fileReceived: !!videoChunkFile,
  });

  if (isLastChunk === "true") {
    if (!roomId || !recordingId || !userId) {
      console.error(
        "Validation Error: Missing essential metadata for final signal.",
        { roomId, recordingId, userId }
      );
      return res
        .status(400)
        .json({
          success: false,
          message: "Missing essential metadata for final signal.",
        });
    }
    console.log(
      `Received FINAL signal for recording track: ${recordingId} in room: ${roomId}`
    );
    await triggerVideoReassemblyJob({ roomId, recordingId, userId });
    return res
      .status(200)
      .json({
        success: true,
        message: "End of recording signal received. Processing job queued.",
      });
  }

  if (!roomId || !recordingId || chunkIndex === undefined || !userId) {
    console.error(
      "Validation Error: Missing required chunk metadata for file upload.",
      { roomId, recordingId, chunkIndex, userId }
    );
    return res
      .status(400)
      .json({
        success: false,
        message: "Missing required chunk metadata for file upload.",
      });
  }

  if (!videoChunkFile || !videoChunkFile.buffer) {
    console.warn(
      "Error: Chunk request received without a file buffer for an intermediate chunk.",
      { roomId, recordingId, chunkIndex }
    );
    return res
      .status(400)
      .json({
        success: false,
        message: "No video chunk file received for intermediate chunk.",
      });
  }

  try {
    await uploadChunkToS3(
      videoChunkFile.buffer,
      videoChunkFile.mimetype,
      roomId,
      recordingId,
      parseInt(chunkIndex)
    );

    res
      .status(200)
      .json({
        success: true,
        message: `Chunk ${chunkIndex} received and uploaded to S3.`,
      });
  } catch (error) {
    console.error(
      `Error in /upload-chunk endpoint for chunk ${chunkIndex}:`,
      error.message
    );
    res
      .status(500)
      .json({
        success: false,
        message: `Failed to process chunk ${chunkIndex} on server: ${error.message}`,
      });
  }
});

// --- API Endpoint to Update lastProcessedVideoLocation (for demo ONLY) ---
app.post("/update-last-processed-video-location", (req, res) => {
  const { location } = req.body;
  if (location) {
    lastProcessedVideoLocation = location;
    console.log(
      `Server: Updated lastProcessedVideoLocation to: ${lastProcessedVideoLocation}`
    );
    res.status(200).json({ success: true });
  } else {
    res
      .status(400)
      .json({ success: false, message: "Missing location in request body" });
  }
});

// --- API Endpoint to Send Processed Video from S3 ---
app.get("/send-blob", async (req, res) => {
  if (!lastProcessedVideoLocation) {
    return res
      .status(404)
      .json({
        message:
          "No processed video available to send. Please record and wait for processing simulation.",
      });
  }

  const downloadParams = {
    Bucket: S3_BUCKET_NAME,
    Key: lastProcessedVideoLocation,
  };

  try {
    const data = await s3.getObject(downloadParams).promise();

    res.setHeader("Content-Type", data.ContentType || "video/webm");
    res.setHeader("Content-Length", data.ContentLength);
    res.send(data.Body);

    console.log(
      `Successfully sent processed video from S3: ${lastProcessedVideoLocation}`
    );
  } catch (error) {
    console.error(
      `Error fetching processed video from S3: ${lastProcessedVideoLocation}`,
      error
    );
    if (error.code === "NoSuchKey") {
      return res
        .status(404)
        .json({
          message:
            "Processed video not found in S3 (might still be processing or path is incorrect).",
        });
    }
    res
      .status(500)
      .json({
        message: `Failed to retrieve processed video from S3: ${error.message}`,
      });
  }
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server listening at http://localhost:${PORT}`);
  console.log(`S3 Bucket: ${S3_BUCKET_NAME}`);
  console.log(`AWS Region: ${process.env.AWS_REGION}`);
  console.log(`Redis Host: ${redisConnection.host}:${redisConnection.port}`);
  console.log(
    `NOTE: Remember to set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME, REDIS_HOST, REDIS_PORT in your .env file.`
  );
});
