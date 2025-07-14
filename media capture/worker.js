// worker.js

// --- Imports ---
const { Worker } = require("bullmq");
const AWS = require("aws-sdk");
const path = require("path");
const { spawn } = require("child_process"); // For running FFmpeg commands
const fs = require("fs"); // For createWriteStream
const fsp = require("fs/promises"); // For promise-based fs operations
require("dotenv").config();

// --- S3 Configuration (Must be the same as your server.js) ---
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION, // e.g., 'eu-north-1'
});
const s3 = new AWS.S3();
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// --- Redis Connection for BullMQ (Must be the same as your server.js) ---
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
 * Executes an FFmpeg command.
 * @param {string[]} args - Array of FFmpeg arguments.
 * @param {string} logPrefix - Prefix for console logs.
 * @returns {Promise<void>}
 */
async function runFFmpeg(args, logPrefix) {
  return new Promise((resolve, reject) => {
    const ffmpegCommand = "ffmpeg"; // Assumes FFmpeg is in system PATH or container PATH
    let ffmpegStderrOutput = "";

    console.log(`${logPrefix}: Running FFmpeg with args: ${args.join(" ")}`);

    const ffmpegProcess = spawn(ffmpegCommand, args);

    ffmpegProcess.stdout.on("data", (data) => {
      // console.log(`${logPrefix} stdout: ${data.toString()}`);
    });

    ffmpegProcess.stderr.on("data", (data) => {
      ffmpegStderrOutput += data.toString();
      // console.error(`${logPrefix} stderr: ${data.toString()}`);
    });

    ffmpegProcess.on("close", (code) => {
      if (code === 0) {
        console.log(
          `${logPrefix}: FFmpeg process exited with code 0 (Success).`
        );
        resolve();
      } else {
        console.error(
          `${logPrefix}: FFmpeg process exited with code ${code} (Failure).`
        );
        console.error(
          `Full FFmpeg stderr for ${logPrefix}:\n${ffmpegStderrOutput}`
        );
        reject(
          new Error(
            `FFmpeg process failed with code ${code}. See full stderr in worker logs.`
          )
        );
      }
    });

    ffmpegProcess.on("error", (err) => {
      console.error(
        `${logPrefix}: Failed to start FFmpeg process: ${err.message}`
      );
      reject(
        new Error(
          `Failed to execute FFmpeg: ${err.message}. Is FFmpeg installed and in PATH?`
        )
      );
    });
  });
}

// --- Job Handler for Individual Track Processing ---
async function processIndividualTrackJob(job) {
  const {
    roomId,
    recordingId,
    userId,
    conferenceRecordingId,
    recordingStartTime,
    recordingEndTime,
  } = job.data;
  console.log(
    `Worker: Starting individual track job for recording: ${recordingId} (User: ${userId}) in room: ${roomId}, conference: ${conferenceRecordingId}.`
  );

  const tempDir = path.join(__dirname, "temp_recordings", userId); // Use userId as subfolder for individual tracks
  let combinedRawVideoPath = "";
  let outputPath = "";

  try {
    await fsp.mkdir(tempDir, { recursive: true });

    // 1. List chunks in S3
    const listParams = {
      Bucket: S3_BUCKET_NAME,
      Prefix: `recordings/${roomId}/${userId}/chunks/`, // Use userId here
    };
    console.log(
      `Worker: Listing objects in S3 with prefix: ${listParams.Prefix}`
    );
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
    console.log(`Worker: Found ${chunkKeys.length} chunks for ${userId}.`);

    // 2. Download all chunks and combine them into a single local file
    combinedRawVideoPath = path.join(tempDir, `${userId}_combined_raw.webm`);
    console.log(
      `Worker: Combining downloaded chunks into single file: ${combinedRawVideoPath}`
    );

    const writeStream = fs.createWriteStream(combinedRawVideoPath);

    for (const key of chunkKeys) {
      const downloadParams = { Bucket: S3_BUCKET_NAME, Key: key };
      const chunkData = await s3.getObject(downloadParams).promise();

      const canContinueWriting = writeStream.write(chunkData.Body);
      if (!canContinueWriting) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }

      console.log(`Worker: Appended chunk ${key} data.`);
    }
    await new Promise((resolve) => writeStream.end(resolve));
    console.log(`Worker: All chunks combined into ${combinedRawVideoPath}`);

    // 3. Execute FFmpeg Re-encoding on the single combined file
    const outputFileName = `${userId}_final.webm`;
    outputPath = path.join(tempDir, outputFileName);

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

    await runFFmpeg(ffmpegArgs, `Worker: FFmpeg Individual Track ${userId}`);

    // Check if the output file was actually created and has a reasonable size
    const stats = await fsp.stat(outputPath);
    if (stats.size <= 100 * 1024) {
      throw new Error(
        `FFmpeg output file too small or invalid for ${userId} (${stats.size} bytes).`
      );
    }
    console.log(
      `Worker: Final video file created successfully with size: ${stats.size} bytes.`
    );

    // 4. Upload Final Video to S3
    const finalS3Key = path.join(
      "final_videos",
      roomId,
      conferenceRecordingId,
      outputFileName
    ); // Store under conferenceRecordingId
    const finalS3KeyFormatted = finalS3Key.replace(/\\/g, "/");

    const finalVideoBuffer = await fsp.readFile(outputPath);
    const finalMimeType = "video/webm";

    await uploadFileBufferToS3(
      finalVideoBuffer,
      finalMimeType,
      finalS3KeyFormatted
    );

    // Report final S3 key back to the server's metadata store
    try {
      await fetch("http://localhost:3000/update-individual-track-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          individualRecordingId: userId, // This is the userId
          conferenceRecordingId,
          s3Key: finalS3KeyFormatted,
          recordingStartTime, // Pass back to server for merge job
          recordingEndTime, // Pass back to server for merge job
        }),
      });
      console.log(`Worker: Reported final S3 key for ${userId} to server.`);
    } catch (fetchError) {
      console.warn(
        `Worker: Could not report final S3 key for ${userId} to server:`,
        fetchError.message
      );
    }

    console.log(
      `Worker: Successfully processed individual recording ${userId}. Final video at S3://${S3_BUCKET_NAME}/${finalS3KeyFormatted}`
    );
  } catch (error) {
    console.error(
      `Worker: Error during individual video processing job for ${userId}:`,
      error
    );
    throw error; // Re-throw to mark BullMQ job as failed
  } finally {
    // Clean up temporary local files and directory
    if (tempDir && (await fsp.stat(tempDir).catch(() => null))) {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
        console.log(`Worker: Cleaned up temporary directory: ${tempDir}`);
      } catch (cleanupError) {
        console.error(
          `Worker: Failed to clean up temporary directory ${tempDir}:`,
          cleanupError
        );
      }
    }
  }
}

// --- Job Handler for Conference Merge Processing ---
async function mergeConferenceJob(job) {
  const {
    roomId,
    conferenceRecordingId,
    actualConferenceStartTime,
    individualTracks,
    hostUserId,
  } = job.data;
  console.log(
    `Worker: Starting conference merge job for Room ID: ${roomId}, Conference Recording ID: ${conferenceRecordingId}.`
  );
  console.log(
    `Worker: Received ${individualTracks.length} individual tracks for merging. Host Audio from: ${hostUserId}`
  );

  const tempDir = path.join(
    __dirname,
    "temp_conference_merge",
    conferenceRecordingId
  );
  let finalConferenceVideoPath = "";

  try {
    await fsp.mkdir(tempDir, { recursive: true });

    // 1. Download individual videos to local tempDir using provided s3Keys
    const participantVideos = []; // Stores { localPath, userId, recordingStartTime, recordingEndTime, duration, offset }
    let maxConferenceDuration = 0; // To determine the total length of the merged video

    // Sort tracks by their start time to ensure consistent processing order
    individualTracks.sort(
      (a, b) => a.recordingStartTime - b.recordingStartTime
    );

    for (const track of individualTracks) {
      const {
        userId: trackUserId,
        recordingStartTime,
        recordingEndTime,
        s3Key,
      } = track;
      const localPath = path.join(tempDir, `${trackUserId}_final.webm`);

      const downloadParams = { Bucket: S3_BUCKET_NAME, Key: s3Key };
      const videoData = await s3.getObject(downloadParams).promise();
      await fsp.writeFile(localPath, videoData.Body);
      console.log(
        `Worker: Downloaded individual video ${s3Key} to ${localPath}`
      );

      const videoDuration = (recordingEndTime - recordingStartTime) / 1000; // Duration in seconds
      const offsetFromConferenceStart =
        (recordingStartTime - actualConferenceStartTime) / 1000; // Offset in seconds

      participantVideos.push({
        localPath: localPath,
        userId: trackUserId,
        recordingStartTime: recordingStartTime,
        recordingEndTime: recordingEndTime,
        duration: videoDuration,
        offset: offsetFromConferenceStart,
      });

      const trackEndRelativeToConference =
        offsetFromConferenceStart + videoDuration;
      if (trackEndRelativeToConference > maxConferenceDuration) {
        maxConferenceDuration = trackEndRelativeToConference;
      }
    }

    if (participantVideos.length === 0) {
      throw new Error(
        "Worker: No participant videos found after download. Cannot proceed with merge layout."
      );
    }
    if (maxConferenceDuration === 0) {
      throw new Error(
        "Calculated conference duration is zero. No valid video content to merge."
      );
    }

    // 2. Construct FFmpeg complex filter graph for merging with timestamp alignment and overlay
    const baseVideoWidth = 640;
    const baseVideoHeight = 480;

    const numVideos = participantVideos.length;
    console.log(`Worker: numVideos calculated as: ${numVideos}`);

    let filterComplexArgs = [];
    let inputMaps = [];

    // Add a base transparent canvas (color source with alpha) for the background
    const outputWidth = 1280;
    const outputHeight = 720;
    filterComplexArgs.push(
      `color=c=black:s=${outputWidth}x${outputHeight}:d=${maxConferenceDuration.toFixed(
        3
      )}:r=30,format=yuv420p[base_canvas];`
    );
    let currentVideoChain = "[base_canvas]";
    let hostAudioInputIndex = -1; // To store the index of the host's audio stream

    // Prepare each participant's video and audio stream
    for (let i = 0; i < numVideos; i++) {
      const p = participantVideos[i];
      inputMaps.push("-i", p.localPath.replace(/\\/g, "/"));

      // Video filter: setpts to align, scale/pad to fit a grid cell, then tpad to full length
      filterComplexArgs.push(
        `[${i}:v]setpts=PTS-STARTPTS+${p.offset}/TB,` +
          `scale=${baseVideoWidth}:${baseVideoHeight}:force_original_aspect_ratio=decrease,` +
          `pad=${baseVideoWidth}:${baseVideoHeight}:(ow-iw)/2:(oh-ih)/2,` +
          `tpad=stop_mode=clone:stop_duration=${maxConferenceDuration.toFixed(
            3
          )}:start_mode=clone:start_duration=${p.offset.toFixed(
            3
          )},format=yuv420p[v${i}];`
      );

      // Check if this is the host's audio stream
      if (p.userId === hostUserId) {
        hostAudioInputIndex = i;
      }
    }

    // Dynamically determine overlay positions based on number of participants
    const positions = [];
    if (numVideos === 1) {
      positions.push({
        x: (outputWidth - baseVideoWidth) / 2,
        y: (outputHeight - baseVideoHeight) / 2,
      });
    } else if (numVideos === 2) {
      positions.push({ x: 0, y: 0 });
      positions.push({ x: baseVideoWidth, y: 0 });
    } else {
      // For more than 2, or if you want a custom layout for 2+
      // Example for 2 participants side-by-side
      positions.push({ x: 0, y: (outputHeight - baseVideoHeight) / 2 }); // Left
      positions.push({
        x: baseVideoWidth,
        y: (outputHeight - baseVideoHeight) / 2,
      }); // Right
      // You can implement more complex grid layouts here based on numVideos
      // For example, 2x2 grid for 4 participants, etc.
    }

    // Chain overlay filters
    for (let i = 0; i < numVideos; i++) {
      const pos = positions[i];
      filterComplexArgs.push(
        `${currentVideoChain}[v${i}]overlay=x=${pos.x}:y=${pos.y}[temp_v${i}];`
      );
      currentVideoChain = `[temp_v${i}]`;
    }
    filterComplexArgs.push(
      `${currentVideoChain}scale=${outputWidth}:${outputHeight},format=yuv420p[v_out];`
    );

    // --- Audio Mixing: Use ONLY the host's audio ---
    // FIX: Ensure audioMapArgs is an array with separate elements for FFmpeg
    let audioMapArgs = [];
    if (hostAudioInputIndex !== -1) {
      audioMapArgs.push("-map", `${hostAudioInputIndex}:a`);
      console.log(
        `Worker: Using audio from input ${hostAudioInputIndex} (Host: ${hostUserId}).`
      );
    } else {
      console.warn(
        `Worker: Host audio track for ${hostUserId} not found. Merged video will have no audio.`
      );
      audioMapArgs.push("-an"); // No audio
    }

    // 3. Execute FFmpeg for conference merge
    const finalConferenceFileName = `conference_${conferenceRecordingId}_merged.webm`;
    finalConferenceVideoPath = path.join(tempDir, finalConferenceFileName);

    const ffmpegMergeArgs = [
      ...inputMaps,
      "-filter_complex",
      filterComplexArgs.join(""),
      "-map",
      "[v_out]",
      ...audioMapArgs, // Spread the array here to ensure separate arguments
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
      "-shortest",
      finalConferenceVideoPath.replace(/\\/g, "/"),
    ];

    await runFFmpeg(
      ffmpegMergeArgs,
      `Worker: FFmpeg Conference Merge ${conferenceRecordingId}`
    );

    // Check if the output file was actually created and has a reasonable size
    const stats = await fsp.stat(finalConferenceVideoPath);
    if (stats.size <= 100 * 1024) {
      throw new Error(
        `FFmpeg conference output file too small or invalid for ${conferenceRecordingId} (${stats.size} bytes).`
      );
    }
    console.log(
      `Worker: Final conference video created successfully with size: ${stats.size} bytes.`
    );

    // 4. Upload Final Conference Video to S3
    const finalS3Key = path.join(
      "final_conference_videos",
      roomId,
      finalConferenceFileName
    );
    const finalS3KeyFormatted = finalS3Key.replace(/\\/g, "/");

    const finalVideoBuffer = await fsp.readFile(finalConferenceVideoPath);
    const finalMimeType = "video/webm";

    await uploadFileBufferToS3(
      finalVideoBuffer,
      finalMimeType,
      finalS3KeyFormatted
    );

    console.log(
      `Worker: Successfully processed conference merge for Room ID: ${roomId}, Recording ID: ${conferenceRecordingId}. Final video at S3://${S3_BUCKET_NAME}/${finalS3KeyFormatted}`
    );

    // Update lastProcessedVideoLocation in main server process
    try {
      await fetch(
        "http://localhost:3000/update-last-processed-video-location",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: finalS3KeyFormatted }),
        }
      );
      console.log(
        "Worker: Sent update to server for /send-blob demo (conference video)."
      );
    } catch (fetchError) {
      console.warn(
        "Worker: Could not update server's lastProcessedVideoLocation for demo (server might not have endpoint or be down):",
        fetchError.message
      );
    }
  } catch (error) {
    console.error(
      `Worker: Error during conference merge job for Room ID ${roomId}, Recording ID ${conferenceRecordingId}:`,
      error
    );
    throw error;
  } finally {
    // Clean up temporary local files and directory
    if (tempDir && (await fsp.stat(tempDir).catch(() => null))) {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
        console.log(`Worker: Cleaned up temporary directory: ${tempDir}`);
      } catch (cleanupError) {
        console.error(
          `Worker: Failed to clean up temporary directory ${tempDir}:`,
          cleanupError
        );
      }
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
});

// --- Worker Event Listeners ---
worker.on("ready", () => console.log("Worker: Ready to process jobs."));
worker.on("completed", (job) =>
  console.log(`Worker: Job ${job.id} completed.`)
);
worker.on("failed", (job, err) =>
  console.error(`Worker: Job ${job.id} failed: ${err.message}`)
);
worker.on("error", (err) =>
  console.error("Worker: General worker error:", err)
);




