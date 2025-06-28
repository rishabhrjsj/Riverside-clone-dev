// worker.js

// --- Imports ---
const { Worker } = require("bullmq");
const AWS = require("aws-sdk");
const path = require("path");
const { spawn } = require("child_process"); // For running FFmpeg commands
const fs = require("fs"); // FIXED: Import the standard 'fs' module for streams
const fsp = require("fs/promises"); // NEW: Import 'fs/promises' as 'fsp' for promise-based operations
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

// --- Helper function to pad chunk index (Same as server.js) ---
function padChunkIndex(index, length = 5) {
  return String(index).padStart(length, "0");
}

/**
 * Uploads a file buffer to AWS S3. Reused for final video upload.
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
    // ACL: 'private',
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
    throw new Error(
      `Worker: S3 Upload Failed for final video: ${error.message}`
    );
  }
}

// --- BullMQ Worker Definition ---
const worker = new Worker(
  "videoProcessing",
  async (job) => {
    const { roomId, recordingId, userId } = job.data;
    console.log(
      `Worker: Starting job for recording track: ${recordingId} in room: ${roomId}`
    );

    const tempDir = path.join(__dirname, "temp_recordings", recordingId); // Create a unique temp directory
    let combinedRawVideoPath = ""; // Path for the single, combined raw video file
    let outputPath = ""; // Path for the final processed video file

    try {
      await fsp.mkdir(tempDir, { recursive: true }); // FIXED: Use fsp.mkdir

      // 1. List chunks in S3
      const listParams = {
        Bucket: S3_BUCKET_NAME,
        Prefix: `recordings/${roomId}/${recordingId}/chunks/`,
      };
      console.log(
        `Worker: Listing objects in S3 with prefix: ${listParams.Prefix}`
      );
      const listedObjects = await s3.listObjectsV2(listParams).promise();

      // Filter out folders (objects with size 0 ending in /) and sort
      const chunkKeys = listedObjects.Contents.filter(
        (obj) => obj.Size > 0 && !obj.Key.endsWith("/")
      )
        .map((obj) => obj.Key)
        .sort(); // Sorts alphabetically, which works due to paddedChunkIndex

      if (chunkKeys.length === 0) {
        throw new Error(
          `Worker: No chunks found in S3 for recordingId: ${recordingId} at prefix ${listParams.Prefix}`
        );
      }
      console.log(
        `Worker: Found ${chunkKeys.length} chunks for ${recordingId}.`
      );

      // 2. Download all chunks and combine them into a single local file
      combinedRawVideoPath = path.join(
        tempDir,
        `${recordingId}_combined_raw.webm`
      );
      console.log(
        `Worker: Combining downloaded chunks into single file: ${combinedRawVideoPath}`
      );

      // Create a write stream to append chunk data
      const writeStream = fs.createWriteStream(combinedRawVideoPath); // FIXED: Use fs.createWriteStream

      for (const key of chunkKeys) {
        const downloadParams = { Bucket: S3_BUCKET_NAME, Key: key };
        const chunkData = await s3.getObject(downloadParams).promise();
        await new Promise((resolve, reject) => {
          writeStream.write(chunkData.Body, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log(`Worker: Appended chunk ${key} data.`);
      }
      // Ensure the write stream is properly closed before FFmpeg tries to read it
      await new Promise((resolve) => writeStream.end(resolve));
      console.log(`Worker: All chunks combined into ${combinedRawVideoPath}`);

      // 3. Execute FFmpeg Re-encoding on the single combined file
      const outputFileName = `${recordingId}_final.webm`;
      outputPath = path.join(tempDir, outputFileName);

      console.log(
        `Worker: Running FFmpeg to re-encode combined raw video to ${outputPath}`
      );
      await new Promise((resolve, reject) => {
        const ffmpegCommand = "ffmpeg"; // Assumes FFmpeg is in system PATH or container PATH
        let ffmpegStderrOutput = "";

        const ffmpegProcess = spawn(ffmpegCommand, [
          "-i",
          combinedRawVideoPath.replace(/\\/g, "/"), // Input is now the single combined file
          "-c:v",
          "vp8", // Re-encode video to VP8
          "-b:v",
          "1M", // Video bitrate (e.g., 1 Mbps, adjust as needed)
          "-c:a",
          "libopus", // Use 'libopus' for audio encoding (non-experimental)
          "-b:a",
          "96k", // Audio bitrate (e.g., 96 Kbps, adjust as needed)
          "-f",
          "webm", // Output format (explicitly webm)
          outputPath.replace(/\\/g, "/"),
        ]);

        ffmpegProcess.stdout.on("data", (data) => {
          // console.log(`FFmpeg stdout: ${data.toString()}`);
        });

        ffmpegProcess.stderr.on("data", (data) => {
          ffmpegStderrOutput += data.toString();
          // console.error(`FFmpeg stderr: ${data.toString()}`);
        });

        ffmpegProcess.on("close", (code) => {
          if (code === 0) {
            console.log(
              `Worker: FFmpeg process exited with code 0 (Success) for ${recordingId}`
            );
            fsp
              .stat(outputPath) // FIXED: Use fsp.stat
              .then((stats) => {
                if (stats.size > 100 * 1024) {
                  console.log(
                    `Worker: Final video file created successfully with size: ${stats.size} bytes.`
                  );
                  resolve();
                } else {
                  console.error(
                    `Worker: FFmpeg finished, but output file ${outputPath} is too small (${stats.size} bytes).`
                  );
                  console.error(
                    `Full FFmpeg stderr for ${recordingId}:\n${ffmpegStderrOutput}`
                  );
                  reject(
                    new Error(
                      `FFmpeg output file too small or invalid for ${recordingId}`
                    )
                  );
                }
              })
              .catch((statError) => {
                console.error(
                  `Worker: Error checking output file stats for ${recordingId}:`,
                  statError
                );
                reject(
                  new Error(
                    `FFmpeg output file not found or accessible for ${recordingId}`
                  )
                );
              });
          } else {
            console.error(
              `Worker: FFmpeg process exited with code ${code} (Failure) for ${recordingId}`
            );
            console.error(
              `Full FFmpeg stderr for ${recordingId}:\n${ffmpegStderrOutput}`
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
            `Worker: Failed to start FFmpeg process for ${recordingId}: ${err.message}`
          );
          reject(
            new Error(
              `Failed to execute FFmpeg: ${err.message}. Is FFmpeg installed and in PATH?`
            )
          );
        });
      });

      // 4. Upload Final Video to S3
      const finalS3Key = path.join("final_videos", roomId, outputFileName);
      const finalS3KeyFormatted = finalS3Key.replace(/\\/g, "/");

      const finalVideoBuffer = await fsp.readFile(outputPath); // FIXED: Use fsp.readFile
      const finalMimeType = "video/webm";

      await uploadFileBufferToS3(
        finalVideoBuffer,
        finalMimeType,
        finalS3KeyFormatted
      );

      // --- Demo specific: Update lastProcessedVideoLocation in main server process (NOT PRODUCTION) ---
      try {
        await fetch(
          "http://localhost:3000/update-last-processed-video-location",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ location: finalS3KeyFormatted }),
          }
        );
        console.log("Worker: Sent update to server for /send-blob demo.");
      } catch (fetchError) {
        console.warn(
          "Worker: Could not update server's lastProcessedVideoLocation for demo (server might not have endpoint or be down):",
          fetchError.message
        );
      }

      console.log(
        `Worker: Successfully processed recording ${recordingId}. Final video at S3://${S3_BUCKET_NAME}/${finalS3KeyFormatted}`
      );

      // --- 5. (Optional) Delete raw chunks from S3 after successful processing ---
      // For production, uncomment this. Ensure final video is fully uploaded before deleting.
      // console.log(`Worker: Deleting ${chunkKeys.length} raw chunks from S3 for ${recordingId}.`);
      // const deleteParams = {
      //     Bucket: S3_BUCKET_NAME,
      //     Delete: { Objects: chunkKeys.map(key => ({ Key: key })) }
      // };
      // await s3.deleteObjects(deleteParams).promise();
      // console.log(`Worker: Raw chunks deleted for ${recordingId}.`);
    } catch (error) {
      console.error(
        `Worker: Error during video processing job for ${recordingId}:`,
        error
      );
      // BullMQ will automatically mark the job as failed if an error is thrown here.
    } finally {
      // 6. Clean up temporary local files and directory
      if (tempDir && (await fsp.stat(tempDir).catch(() => null))) {
        // FIXED: Use fsp.stat
        try {
          await fsp.rm(tempDir, { recursive: true, force: true }); // FIXED: Use fsp.rm
          console.log(`Worker: Cleaned up temporary directory: ${tempDir}`);
        } catch (cleanupError) {
          console.error(
            `Worker: Failed to clean up temporary directory ${tempDir}:`,
            cleanupError
          );
        }
      }
    }
  },
  { connection: redisConnection }
);

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
