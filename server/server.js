// --- Imports ---
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const AWS = require("aws-sdk");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const userRoutes = require("./routes/user.js");
const studioRoutes = require("./routes/studio.js");
const cookieParser = require("cookie-parser");

mongoose
  .connect("mongodb://127.0.0.1:27017/riverside", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// --- BullMQ Imports ---
const { Queue } = require("bullmq");

// --- Express App Setup ---
const app = express();
app.use(
  cors({
    origin: "http://localhost:5173", // your frontend URL
    credentials: true,
  })
);
app.use(express.json()); // Essential for parsing JSON body
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// --- Redis Connection for BullMQ ---
const redisConnection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
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

// --- In-memory store for participant metadata (DEMO ONLY - use DB in production) ---
// Structure: { roomId: { conferenceRecordingId: { userId: { userId, recordingStartTime, recordingEndTime, s3Key? } } } }
const conferenceMetadataStore = {};

// --- Helper function to pad chunk index ---
function padChunkIndex(index, length = 5) {
  return String(index).padStart(length, "0");
}

/**
 * Uploads a single video chunk to AWS S3.
 */
async function uploadChunkToS3(
  chunkBuffer,
  mimeType,
  roomId,
  recordingId,
  chunkIndex
) {
  let s3Key = path.join(
    "recordings",
    roomId,
    recordingId, // This recordingId is unique per participant's track within a conference
    "chunks",
    `chunk_${padChunkIndex(chunkIndex)}.webm`
  );
  s3Key = s3Key.replace(/\\/g, "/");

  const uploadParams = {
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
    Body: chunkBuffer,
    ContentType: mimeType,
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

// --- Function to trigger a background video reassembly job ---
async function triggerIndividualTrackProcessingJob(jobDetails) {
  try {
    await videoProcessingQueue.add("processIndividualTrackJob", jobDetails, {
      removeOnComplete: true,
      removeOnFail: false,
      jobId: `process-track-${jobDetails.userId}`, // Use userId as the unique job ID for individual tracks
    });
    console.log(
      `[JOB QUEUE] Added individual track job for user: ${jobDetails.userId} to queue.`
    );
  } catch (error) {
    console.error(
      `[JOB QUEUE] Failed to add individual track job for user ${jobDetails.userId}:`,
      error
    );
  }
}

// --- Function to trigger a conference merge job ---
async function triggerConferenceMergeJob(
  roomId,
  conferenceRecordingId,
  hostUserId
) {
  const conferenceSessionMetadata =
    conferenceMetadataStore[roomId] &&
    conferenceMetadataStore[roomId][conferenceRecordingId];

  if (!conferenceSessionMetadata) {
    throw new Error(
      `No conference session metadata found for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId}. Cannot merge.`
    );
  }

  const individualTracksMetadata = Object.values(conferenceSessionMetadata);

  // Ensure all tracks have their s3Key set before queuing the merge job
  const allTracksReady = individualTracksMetadata.every(
    (track) => track.s3Key && typeof track.s3Key === "string"
  );
  if (!allTracksReady) {
    throw new Error(
      `Not all individual tracks for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId} have their S3 keys ready. Cannot merge.`
    );
  }

  if (individualTracksMetadata.length === 0) {
    throw new Error(
      `No individual track metadata found for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId}. Cannot merge.`
    );
  }

  // Determine the actual conference start time from the earliest recordingStartTime among participants
  const actualConferenceStartTime = Math.min(
    ...individualTracksMetadata.map((track) => track.recordingStartTime)
  );

  try {
    await videoProcessingQueue.add(
      "mergeConferenceJob",
      {
        roomId,
        conferenceRecordingId,
        actualConferenceStartTime, // Pass the determined earliest start time
        individualTracks: individualTracksMetadata, // Pass all collected metadata
        hostUserId, // Pass the host's user ID for audio selection
      },
      {
        removeOnComplete: true,
        removeOnFail: false,
        jobId: `merge-conference-${conferenceRecordingId}`,
      }
    );
    console.log(
      `[JOB QUEUE] Added conference merge job for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId} with ${individualTracksMetadata.length} tracks to queue. Host Audio: ${hostUserId}`
    );
  } catch (error) {
    console.error(
      `[JOB QUEUE] Failed to add conference merge job for Room ID ${roomId}, Recording ID ${conferenceRecordingId}:`,
      error
    );
    throw error; // Re-throw to inform the caller
  }
}

// --- Global variable to store the simulated S3 key of the last processed video ---
let lastProcessedVideoLocation = null;

// --- API Endpoint to Receive Chunks ---
app.post("/upload-chunk", upload.single("videoChunk"), async (req, res) => {
  const {
    roomId,
    recordingId,
    chunkIndex,
    userId,
    timestamp,
    isLastChunk,
    recordingStartTime,
    recordingEndTime,
  } = req.body;

  const videoChunkFile = req.file;

  if (isLastChunk === "true") {
    if (
      !roomId ||
      !recordingId ||
      !userId ||
      !recordingStartTime ||
      !recordingEndTime
    ) {
      console.error(
        "Validation Error: Missing essential metadata or timestamps for final signal.",
        { roomId, recordingId, userId, recordingStartTime, recordingEndTime }
      );
      return res.status(400).json({
        success: false,
        message: "Missing essential metadata or timestamps for final signal.",
      });
    }
    console.log(
      `Received FINAL signal for recording track: ${recordingId} in room: ${roomId}. User: ${userId}. Start: ${recordingStartTime}, End: ${recordingEndTime}`
    );

    // Store metadata in the in-memory store for later conference merging
    if (!conferenceMetadataStore[roomId]) {
      conferenceMetadataStore[roomId] = {};
    }
    if (!conferenceMetadataStore[roomId][recordingId]) {
      // recordingId here is the conferenceRecordingId
      conferenceMetadataStore[roomId][recordingId] = {};
    }
    // Store individual track details under the conferenceRecordingId
    conferenceMetadataStore[roomId][recordingId][userId] = {
      // userId is the unique identifier for THIS track
      recordingId: recordingId, // This is the conferenceRecordingId
      userId: userId, // This is the individual participant's recordingUserId
      recordingStartTime: parseInt(recordingStartTime),
      recordingEndTime: parseInt(recordingEndTime),
      s3Key: undefined, // Initialize s3Key as undefined, will be updated by worker
    };

    // FIX: Pass userId explicitly as 'userId' in jobDetails
    await triggerIndividualTrackProcessingJob({
      roomId,
      userId: userId, // Pass userId here
      conferenceRecordingId: recordingId, // This is the conference recording ID
      recordingStartTime: parseInt(recordingStartTime),
      recordingEndTime: parseInt(recordingEndTime),
    });

    return res.status(200).json({
      success: true,
      message: "End of recording signal received. Processing job queued.",
    });
  }

  if (!roomId || !recordingId || chunkIndex === undefined || !userId) {
    console.error(
      "Validation Error: Missing required chunk metadata for file upload.",
      { roomId, recordingId, chunkIndex, userId }
    );
    return res.status(400).json({
      success: false,
      message: "Missing required chunk metadata for file upload.",
    });
  }

  if (!videoChunkFile || !videoChunkFile.buffer) {
    console.warn("Received a chunk request but no file buffer was present.");
    return res
      .status(400)
      .json({ success: false, message: "No video chunk file received." });
  }

  try {
    // Here, recordingId from frontend is actually conferenceRecordingId
    // The individual track ID for S3 will be the userId
    await uploadChunkToS3(
      videoChunkFile.buffer,
      videoChunkFile.mimetype,
      roomId,
      userId, // Use userId as the individual track ID in S3 path
      parseInt(chunkIndex)
    );

    res.status(200).json({
      success: true,
      message: `Chunk ${chunkIndex} received and uploaded to S3.`,
    });
  } catch (error) {
    console.error(
      `Error in /upload-chunk endpoint for chunk ${chunkIndex}:`,
      error.message
    );
    res.status(500).json({
      success: false,
      message: `Failed to process chunk ${chunkIndex} on server: ${error.message}`,
    });
  }
});

// --- API Endpoint for Worker to Update Individual Track Metadata ---
app.post("/update-individual-track-metadata", (req, res) => {
  const {
    roomId,
    individualRecordingId,
    conferenceRecordingId,
    s3Key,
    recordingStartTime,
    recordingEndTime,
  } = req.body; // Added timestamps back
  if (roomId && individualRecordingId && conferenceRecordingId && s3Key) {
    if (
      conferenceMetadataStore[roomId] &&
      conferenceMetadataStore[roomId][conferenceRecordingId] &&
      conferenceMetadataStore[roomId][conferenceRecordingId][
        individualRecordingId
      ]
    ) {
      conferenceMetadataStore[roomId][conferenceRecordingId][
        individualRecordingId
      ].s3Key = s3Key;
      // Update timestamps in metadata store if they are passed back from worker (optional, but good for consistency)
      if (recordingStartTime !== undefined) {
        conferenceMetadataStore[roomId][conferenceRecordingId][
          individualRecordingId
        ].recordingStartTime = parseInt(recordingStartTime);
      }
      if (recordingEndTime !== undefined) {
        conferenceMetadataStore[roomId][conferenceRecordingId][
          individualRecordingId
        ].recordingEndTime = parseInt(recordingEndTime);
      }

      console.log(
        `Server: Updated s3Key for individual recording ${individualRecordingId} in conference ${conferenceRecordingId} in room ${roomId}: ${s3Key}`
      );
      res.status(200).json({ success: true });
    } else {
      console.warn(
        `Server: Attempted to update metadata for non-existent individual recording ${individualRecordingId} in conference ${conferenceRecordingId} in room ${roomId}.`
      );
      res.status(404).json({
        success: false,
        message: "Recording not found in metadata store.",
      });
    }
  } else {
    res.status(400).json({
      success: false,
      message:
        "Missing roomId, individualRecordingId, conferenceRecordingId, or s3Key.",
    });
  }
});

// --- API Endpoint to Get Conference Status (for Frontend to check readiness) ---
app.get("/conference-status/:roomId/:conferenceRecordingId", (req, res) => {
  const { roomId, conferenceRecordingId } = req.params;
  const conferenceSessionMetadata =
    conferenceMetadataStore[roomId] &&
    conferenceMetadataStore[roomId][conferenceRecordingId];

  if (!conferenceSessionMetadata) {
    return res.status(404).json({
      message: "Conference session not found or no recordings started yet.",
      readyForMerge: false,
    });
  }

  const individualTracks = Object.values(conferenceSessionMetadata);
  const totalTracks = individualTracks.length;
  const readyTracks = individualTracks.filter(
    (track) => track.s3Key && typeof track.s3Key === "string"
  ).length;

  const readyForMerge = totalTracks > 0 && totalTracks === readyTracks;

  res.status(200).json({
    roomId,
    conferenceRecordingId,
    totalTracks,
    readyTracks,
    readyForMerge,
    tracks: individualTracks.map((track) => ({
      recordingId: track.recordingId, // This is the conferenceRecordingId
      userId: track.userId, // This is the individual participant's recordingUserId
      isReady: !!track.s3Key, // Simple boolean flag for frontend
    })),
  });
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

// --- API Endpoint to Trigger Conference Merge ---
app.post("/trigger-conference-merge", async (req, res) => {
  const { roomId, conferenceRecordingId, hostUserId } = req.body;

  if (!roomId || !conferenceRecordingId || !hostUserId) {
    console.error(
      "Validation Error: Missing roomId, conferenceRecordingId, or hostUserId for conference merge trigger."
    );
    return res.status(400).json({
      success: false,
      message: "Missing required parameters for conference merge trigger.",
    });
  }

  console.log(
    `Received request to trigger conference merge for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId}. Host Audio: ${hostUserId}`
  );
  try {
    await triggerConferenceMergeJob(roomId, conferenceRecordingId, hostUserId);
    res.status(200).json({
      success: true,
      message: `Conference merge job queued for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId}.`,
    });
  } catch (error) {
    console.error(
      `Error triggering conference merge for Room ID ${roomId}, Recording ID ${conferenceRecordingId}:`,
      error
    );
    res.status(500).json({
      success: false,
      message: `Failed to queue conference merge job: ${error.message}`,
    });
  }
});

// --- API Endpoint to Send Processed Video from S3 ---
app.get("/send-blob", async (req, res) => {
  if (!lastProcessedVideoLocation) {
    return res.status(404).json({
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
      return res.status(404).json({
        message:
          "Processed video not found in S3 (might still be processing or path is incorrect).",
      });
    }
    res.status(500).json({
      message: `Failed to retrieve processed video from S3: ${error.message}`,
    });
  }
});

app.use("/api/users", userRoutes);
app.use("/api/studio", studioRoutes);

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
