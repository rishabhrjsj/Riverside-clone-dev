// worker.js

// --- Imports ---
const { Worker } = require("bullmq");
const AWS = require("aws-sdk");
const path = require("path");
const { spawn } = require("child_process"); // For running FFmpeg commands
const fs = require("fs"); // For createWriteStream
const fsp = require("fs/promises"); // For promise-based fs operations
require("dotenv").config();

// --- S3 Configuration ---
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
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
  "Worker: Connecting BullMQ to Redis at:",
  redisConnection.host,
  ":",
  redisConnection.port
);

// --- Helper function to pad chunk index ---
function padChunkIndex(index, length = 5) {
  return String(index).padStart(length, "0");
}

/**
 * Uploads a file buffer to AWS S3.
 * @param {Buffer} fileBuffer - The binary data of the file.
 * @param {string} mimeType - The MIME type of the file.
 * @param {string} s3Key - The full S3 key (path + filename) for the object.
 * @returns {Promise<AWS.S3.ManagedUpload.SendData>}
 */
async function uploadFileBufferToS3(fileBuffer, mimeType, s3Key) {
  const uploadParams = {
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType,
  };

  try {
    const data = await s3.upload(uploadParams).promise();
    console.log(
      `Worker: Successfully uploaded final video to S3: ${data.Location}`
    );
    return data;
  } catch (error) {
    console.error(
      `Worker: Error uploading final video to S3 (${s3Key}):`,
      error
    );
    throw new Error(`Worker: S3 Upload Failed: ${error.message}`);
  }
}

/**
 * Executes an FFmpeg/FFprobe command.
 * @param {string} command - The command to run ('ffmpeg' or 'ffprobe').
 * @param {string[]} args - Array of command arguments.
 * @param {string} logPrefix - Prefix for console logs.
 * @returns {Promise<string>} - Resolves with the stdout of the command.
 */
async function runCommand(command, args, logPrefix) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    console.log(`${logPrefix}: Running command: ${command} ${args.join(" ")}`);

    const process = spawn(command, args);

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        console.log(
          `${logPrefix}: ${command} process exited with code 0 (Success).`
        );
        resolve(stdout);
      } else {
        console.error(
          `${logPrefix}: ${command} process exited with code ${code} (Failure).`
        );
        console.error(`Full stderr for ${logPrefix}:\n${stderr}`);
        reject(
          new Error(
            `${command} process failed with code ${code}. See full stderr in worker logs.`
          )
        );
      }
    });

    process.on("error", (err) => {
      console.error(
        `${logPrefix}: Failed to start ${command} process: ${err.message}`
      );
      reject(
        new Error(
          `Failed to execute ${command}: ${err.message}. Is it installed and in PATH?`
        )
      );
    });
  });
}

/**
 * [NEW] Helper function to get video duration using ffprobe.
 * @param {string} filePath - Path to the video file.
 * @returns {Promise<number>} - Duration in seconds.
 */
async function getVideoDuration(filePath) {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath.replace(/\\/g, "/"),
  ];
  try {
    const durationStr = await runCommand(
      "ffprobe",
      args,
      `FFprobe Duration Check`
    );
    const duration = parseFloat(durationStr);
    if (isNaN(duration)) {
      throw new Error("FFprobe did not return a valid number for duration.");
    }
    return duration;
  } catch (error) {
    console.error(`Error getting duration for ${filePath}:`, error);
    return 0; // Return 0 if duration can't be determined
  }
}

// --- Job Handler for Individual Track Processing ---
// This function remains unchanged as the logic for processing individual
// tracks before the merge is still valid.
// --- Job Handler for Individual Track Processing ---
async function processIndividualTrackJob(job) {
  // [MODIFIED] Removed recordingStartTime and recordingEndTime from destructuring
  const { roomId, recordingId, userId, conferenceRecordingId } = job.data;
  console.log(
    `Worker: Starting individual track job for recording: ${recordingId} (User: ${userId}) in room: ${roomId}, conference: ${conferenceRecordingId}.`
  );

  const tempDir = path.join(__dirname, "temp_recordings", userId);
  let combinedRawVideoPath = "";
  let outputPath = "";

  try {
    await fsp.mkdir(tempDir, { recursive: true });

    // 1. List and download chunks from S3
    const listParams = {
      Bucket: S3_BUCKET_NAME,
      Prefix: `recordings/${roomId}/${userId}/chunks/`,
    };
    const listedObjects = await s3.listObjectsV2(listParams).promise();
    const chunkKeys = listedObjects.Contents.filter(
      (obj) => obj.Size > 0 && !obj.Key.endsWith("/")
    )
      .map((obj) => obj.Key)
      .sort();

    if (chunkKeys.length === 0) {
      throw new Error(
        `Worker: No chunks found in S3 for userId: ${userId} at prefix ${listParams.Prefix}`
      );
    }

    // 2. Combine chunks into a single local file
    combinedRawVideoPath = path.join(tempDir, `${userId}_combined_raw.webm`);
    const writeStream = fs.createWriteStream(combinedRawVideoPath);
    for (const key of chunkKeys) {
      const chunkData = await s3
        .getObject({ Bucket: S3_BUCKET_NAME, Key: key })
        .promise();
      writeStream.write(chunkData.Body);
    }
    await new Promise((resolve) => writeStream.end(resolve));

    // 3. Re-encode the combined individual track
    outputPath = path.join(tempDir, `${userId}_final.webm`);
    const ffmpegArgs = [
      "-i",
      combinedRawVideoPath.replace(/\\/g, "/"),
      "-c:v",
      "vp8",
      "-b:v",
      "1M",
      "-c:a",
      "libopus",
      "-b:a",
      "96k",
      "-f",
      "webm",
      outputPath.replace(/\\/g, "/"),
    ];
    await runCommand(
      "ffmpeg",
      ffmpegArgs,
      `Worker: FFmpeg Individual Track ${userId}`
    );

    // 4. Upload the final individual track to S3
    const finalS3Key = path
      .join(
        "final_videos",
        roomId,
        conferenceRecordingId,
        `${userId}_final.webm`
      )
      .replace(/\\/g, "/");
    const finalVideoBuffer = await fsp.readFile(outputPath);
    await uploadFileBufferToS3(finalVideoBuffer, "video/webm", finalS3Key);

    // 5. Report the final S3 key back to the server
    await fetch("http://localhost:3000/update-individual-track-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // [MODIFIED] Removed recordingStartTime and recordingEndTime from the payload
      body: JSON.stringify({
        roomId,
        individualRecordingId: userId,
        conferenceRecordingId,
        s3Key: finalS3Key,
      }),
    });

    console.log(
      `Worker: Successfully processed individual recording ${userId}.`
    );
  } catch (error) {
    console.error(
      `Worker: Error during individual video processing for ${userId}:`,
      error
    );
    throw error;
  } finally {
    // Cleanup temporary directory
    if (tempDir)
      await fsp
        .rm(tempDir, { recursive: true, force: true })
        .catch((err) =>
          console.error(`Failed to cleanup temp dir ${tempDir}`, err)
        );
  }
}

// --- [REFACTORED] Job Handler for Conference Merge Processing ---
async function mergeConferenceJob(job) {
  const { roomId, conferenceRecordingId, individualTracks } = job.data;
  // REMOVED: hostUserId, actualConferenceStartTime are no longer needed.
  console.log(
    `Worker: Starting REFACTORED conference merge for: ${conferenceRecordingId}.`
  );
  console.log(
    `Worker: Received ${individualTracks.length} tracks for side-by-side merging.`
  );

  const tempDir = path.join(
    __dirname,
    "temp_conference_merge",
    conferenceRecordingId
  );

  try {
    await fsp.mkdir(tempDir, { recursive: true });

    // 1. Download all final individual tracks and find the longest one
    const downloadedTracks = []; // { localPath, duration }
    let longestTrack = { duration: 0, path: null, index: -1 };

    for (let i = 0; i < individualTracks.length; i++) {
      const track = individualTracks[i];
      const localPath = path.join(tempDir, `${track.userId}_final.webm`);

      console.log(`Worker: Downloading ${track.s3Key} to ${localPath}`);
      const videoData = await s3
        .getObject({ Bucket: S3_BUCKET_NAME, Key: track.s3Key })
        .promise();
      await fsp.writeFile(localPath, videoData.Body);

      // [NEW] Get duration of the downloaded video
      const duration = await getVideoDuration(localPath);
      console.log(`Worker: Track ${track.userId} has duration: ${duration}s`);

      downloadedTracks.push({ localPath, duration });

      if (duration > longestTrack.duration) {
        longestTrack = { duration, path: localPath, index: i };
      }
    }

    if (downloadedTracks.length === 0) {
      throw new Error("No tracks were downloaded; cannot merge.");
    }
    if (longestTrack.index === -1) {
      throw new Error("Could not determine the longest track for audio.");
    }

    console.log(
      `Worker: Longest track is at index ${longestTrack.index} with duration ${longestTrack.duration}s. Its audio will be used.`
    );

    // 2. Construct FFmpeg command for side-by-side layout (hstack)
    const ffmpegMergeArgs = [];
    const filterComplexParts = [];
    let videoLayoutOutput = "";

    // Add all downloaded files as inputs
    downloadedTracks.forEach((track) => {
      ffmpegMergeArgs.push("-i", track.localPath.replace(/\\/g, "/"));
    });

    const numVideos = downloadedTracks.length;

    // Create a horizontal stack (side-by-side) layout
    // Example: [0:v][1:v][2:v]hstack=inputs=3[v]
    let hstackInputs = "";
    for (let i = 0; i < numVideos; i++) {
      hstackInputs += `[${i}:v]`;
    }
    filterComplexParts.push(`${hstackInputs}hstack=inputs=${numVideos}[v]`);
    videoLayoutOutput = "[v]";

    // [EXPLANATION] FFmpeg Filters Used:
    // `hstack`: This filter takes multiple video inputs and arranges them horizontally.
    // It's much simpler than manual overlay calculations. The number of inputs
    // must match the stream specifiers (e.g., `[0:v][1:v]`).

    // 3. Finalize FFmpeg arguments
    const finalConferenceFileName = `conference_${conferenceRecordingId}_merged.webm`;
    const finalConferenceVideoPath = path.join(
      tempDir,
      finalConferenceFileName
    );

    ffmpegMergeArgs.push(
      "-filter_complex",
      filterComplexParts.join(";"),
      "-map",
      videoLayoutOutput, // Map the combined video stream
      "-map",
      `${longestTrack.index}:a`, // [NEW] Map audio from the longest track
      "-c:v",
      "vp8",
      "-b:v",
      "2M",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-f",
      "webm",
      "-shortest", // Ensures output duration doesn't exceed the shortest input (useful with hstack)
      finalConferenceVideoPath.replace(/\\/g, "/")
    );

    // 4. Execute FFmpeg merge command
    await runCommand(
      "ffmpeg",
      ffmpegMergeArgs,
      `Worker: FFmpeg Conference Merge ${conferenceRecordingId}`
    );

    // 5. Upload final merged video to S3
    const finalS3Key = path
      .join("final_conference_videos", roomId, finalConferenceFileName)
      .replace(/\\/g, "/");
    const finalVideoBuffer = await fsp.readFile(finalConferenceVideoPath);
    await uploadFileBufferToS3(finalVideoBuffer, "video/webm", finalS3Key);

    console.log(
      `Worker: Successfully merged conference. Final video at S3://${S3_BUCKET_NAME}/${finalS3Key}`
    );

    // 6. [Optional] Update server with final location
    try {
      await fetch(
        "http://localhost:3000/update-last-processed-video-location",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: finalS3Key }),
        }
      );
    } catch (fetchError) {
      console.warn(
        `Worker: Could not update server's final video location: ${fetchError.message}`
      );
    }
  } catch (error) {
    console.error(
      `Worker: Error during refactored conference merge for ${conferenceRecordingId}:`,
      error
    );
    throw error;
  } finally {
    // 7. Cleanup
    if (tempDir) {
      await fsp
        .rm(tempDir, { recursive: true, force: true })
        .catch((err) =>
          console.error(`Failed to cleanup temp dir ${tempDir}`, err)
        );
      console.log(`Worker: Cleaned up temporary directory: ${tempDir}`);
    }
  }
}

// --- BullMQ Worker Processor Function ---
const workerProcessor = async (job) => {
  if (job.name === "processIndividualTrackJob") {
    await processIndividualTrackJob(job);
  } else if (job.name === "mergeConferenceJob") {
    await mergeConferenceJob(job);
  } else {
    console.warn(
      `Worker: Unknown job type received: ${job.name}. Job ID: ${job.id}`
    );
    throw new Error(`Unknown job type: ${job.name}`);
  }
};

// --- BullMQ Worker Definition ---
const worker = new Worker("videoProcessing", workerProcessor, {
  connection: redisConnection,
  concurrency: 5, // Process multiple jobs concurrently
});

// --- Worker Event Listeners ---
worker.on("ready", () => console.log("Worker: Ready to process jobs."));
worker.on("completed", (job) =>
  console.log(`Worker: Job ${job.id} (${job.name}) completed.`)
);
worker.on("failed", (job, err) =>
  console.error(`Worker: Job ${job.id} (${job.name}) failed: ${err.message}`)
);
worker.on("error", (err) =>
  console.error("Worker: General worker error:", err)
);
