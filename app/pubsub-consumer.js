const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const archiver = require('archiver');
const got = require('got');

const pubsub = new PubSub({
  projectId: process.env.PROJECT_ID
});

const storage = new Storage();

if (!global.completedZips) {
  global.completedZips = {};
}

async function downloadImage(url) {
  const response = await got.default.get(url, { responseType: 'buffer' });
  return response.body;
}

async function zipAndUploadImages(tags) {
  console.log(`Starting to process zip for tags: ${tags}`);

  try {
    const photoModel = require('./photo_model');
    const photos = await photoModel.getFlickrPhotos(tags, 'any');

    if (photos.length === 0) {
      console.log('No photos found for tags:', tags);
      return;
    }

    const photosToZip = photos.slice(0, 10);
    console.log(`Found ${photosToZip.length} photos to zip`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));

    for (let i = 0; i < photosToZip.length; i++) {
      const photo = photosToZip[i];
      try {
        console.log(`Downloading image ${i + 1}/${photosToZip.length}: ${photo.title}`);
        const imageBuffer = await downloadImage(photo.media.b);
        const imageFilename = `${i + 1}-${photo.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.jpg`;
        archive.append(imageBuffer, { name: imageFilename });
      } catch (error) {
        console.error(`Error downloading image ${photo.title}:`, error.message);
      }
    }

    await archive.finalize();
    const zipBuffer = Buffer.concat(chunks);

    const uploadedFile = {
      mimetype: 'application/zip',
      buffer: zipBuffer
    };

    const filename = `photos-${Date.now()}-${Math.random().toString(36).substring(7)}.zip`;

    const file = await storage
      .bucket(process.env.STORAGE_BUCKET)
      .file(`public/zips/${filename}`);

    const stream = file.createWriteStream({
      metadata: {
        contentType: uploadedFile.mimetype,
        cacheControl: 'private'
      },
      resumable: false
    });

    await new Promise((resolve, reject) => {
      stream.on('error', (err) => {
        reject(err);
      });
      stream.on('finish', () => {
        resolve('Ok');
      });
      stream.end(uploadedFile.buffer);
    });

    console.log(`Zip uploaded successfully: ${filename}`);

    global.completedZips[tags] = `public/zips/${filename}`;
    console.log(`Zip job completed for tags: ${tags}`);

  } catch (error) {
    console.error(`Error processing zip for tags ${tags}:`, error);
    throw error;
  }
}

function listenForMessages() {
  const subscriptionName = process.env.SUBSCRIPTION_NAME;
  const subscription = pubsub.subscription(subscriptionName);

  console.log(`Listening for messages on subscription: ${subscriptionName}`);

  const messageHandler = async (message) => {
    console.log(`Received message ${message.id}:`);
    console.log(`Data: ${message.data}`);

    try {
      const messageData = JSON.parse(message.data.toString());
      const tags = messageData.tags;

      await zipAndUploadImages(tags);

      message.ack();
      console.log(`Message ${message.id} acknowledged.`);
    } catch (error) {
      console.error('Error processing message:', error);
      message.nack();
    }
  };

  subscription.on('message', messageHandler);

  subscription.on('error', (error) => {
    console.error('Subscription error:', error);
  });
}

module.exports = {
  listenForMessages
};
