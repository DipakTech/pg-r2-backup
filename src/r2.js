'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const fs = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Build an S3Client configured for Cloudflare R2.
 *
 * R2 quirks handled here:
 *  - Custom endpoint: https://<accountId>.r2.cloudflarestorage.com
 *  - Region must be "auto"
 *  - forcePathStyle is not needed for R2 (virtual-hosted style works), but we
 *    keep it false (default) to stay compatible.
 */
function createR2Client(config) {
  const clientConfig = {
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    // Disable checksum behaviour that can cause SignatureDoesNotMatch on R2
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };

  if (config.r2AccessKeyId && config.r2SecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    };
  }
  // If no explicit credentials are provided, the SDK falls back to the
  // standard credential chain (env vars, ~/.aws/credentials, instance metadata).

  return new S3Client(clientConfig);
}

/**
 * Upload a local file to R2.
 * Uses PutObjectCommand (equivalent to s3api put-object in the bash script)
 * so that a standard Content-Length request is sent instead of chunked
 * Transfer-Encoding, which R2 handles more reliably.
 */
async function uploadFile(client, bucket, key, localPath) {
  const body = fs.createReadStream(localPath);
  const size = fs.statSync(localPath).size;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: size,
      ContentType: 'application/gzip',
    })
  );
}

/**
 * Download a file from R2 to a local path.
 */
async function downloadFile(client, bucket, key, localPath) {
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  const outStream = fs.createWriteStream(localPath);
  await pipeline(Body, outStream);
}

/**
 * List all objects in the bucket, optionally filtered by a prefix.
 * Returns an array of { key, size, lastModified } objects.
 */
async function listObjects(client, bucket, prefix = '') {
  const objects = [];
  let continuationToken;

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of resp.Contents || []) {
      objects.push({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
      });
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Delete a single object from R2.
 */
async function deleteObject(client, bucket, key) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = { createR2Client, uploadFile, downloadFile, listObjects, deleteObject };
