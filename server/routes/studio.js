const express = require("express");
const router = express.Router();
const AWS = require("aws-sdk");
require("dotenv").config();
const authenticateUser = require("../Middleware/AuthMiddleware");
// AWS SDK configuration (you only need this once)
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION, // e.g., 'ap-south-1'
  signatureVersion: "v4",
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME; // Use from .env

// GET all .webm files for a given roomId
router.get("/finalvideos/:roomId", authenticateUser, async (req, res) => {
  const { roomId } = req.params;

  const prefix = `final_videos/${roomId}/`;

  try {
    const listParams = {
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    };

    const listedObjects = await s3.listObjectsV2(listParams).promise();

    const webmFiles = listedObjects.Contents.filter((obj) =>
      obj.Key.endsWith(".webm")
    );

    if (webmFiles.length === 0) {
      return res.status(404).json({ message: "No .webm files found." });
    }

    const signedUrls = await Promise.all(
      webmFiles.map(async (file) => {
        const signedUrl = await s3.getSignedUrlPromise("getObject", {
          Bucket: BUCKET_NAME,
          Key: file.Key,
          Expires: 60 * 20, // 5 minutes
        });

        return {
          fileName: file.Key.split("/").pop(),
          key: file.Key,
          url: signedUrl,
          lastModified: file.LastModified,
        };
      })
    );

    return res.json(signedUrls);
  } catch (err) {
    console.error("S3 Error:", err);
    return res.status(500).json({ error: "Failed to fetch .webm files" });
  }
});

// GET /api/studio/conferencevideos/:roomId
router.get("/conferencevideos/:roomId", authenticateUser, async (req, res) => {
  const { roomId } = req.params;
  const prefix = `final_conference_videos/${roomId}/`;

  try {
    const listParams = {
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    };

    const listedObjects = await s3.listObjectsV2(listParams).promise();

    const webmFiles = listedObjects.Contents.filter((obj) =>
      obj.Key.endsWith(".webm")
    );

    if (webmFiles.length === 0) {
      return res
        .status(404)
        .json({ message: "No .webm conference videos found." });
    }

    const signedUrls = await Promise.all(
      webmFiles.map(async (file) => {
        const signedUrl = await s3.getSignedUrlPromise("getObject", {
          Bucket: BUCKET_NAME,
          Key: file.Key,
          Expires: 60 * 20, // valid for 5 mins
        });

        return {
          fileName: file.Key.split("/").pop(),
          key: file.Key,
          url: signedUrl,
          lastModified: file.LastModified,
        };
      })
    );

    return res.json(signedUrls);
  } catch (err) {
    console.error("S3 Conference Video Error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch conference videos." });
  }
});

module.exports = router;
