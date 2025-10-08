const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const pubsubProducer = require('./pubsub-producer');
const { rateLimiter } = require('./rate-limiter');
const { Storage } = require('@google-cloud/storage');
const moment = require('moment');

const storage = new Storage();

function route(app) {
  app.get('/', (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode;
    const zipRequested = req.query.zipRequested === 'true';

    const ejsLocalVariables = {
      tagsParameter: tags || '',
      tagmodeParameter: tagmode || '',
      photos: [],
      searchResults: false,
      invalidParameters: false,
      zipUrl: null,
      zipRequested: zipRequested,
      firebaseConfig: {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        projectId: process.env.PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
      }
    };

    // if no input params are passed in then render the view with out querying the api
    if (!tags && !tagmode) {
      return res.render('index', ejsLocalVariables);
    }

    // validate query parameters
    if (!formValidator.hasValidFlickrAPIParams(tags, tagmode)) {
      ejsLocalVariables.invalidParameters = true;
      return res.render('index', ejsLocalVariables);
    }

    // get photos from flickr public feed api
    return photoModel
      .getFlickrPhotos(tags, tagmode)
      .then(async photos => {
        ejsLocalVariables.photos = photos;
        ejsLocalVariables.searchResults = true;

        if (global.completedZips && global.completedZips[tags]) {
          const name = global.completedZips[tags];
          const options = {
            action: 'read',
            expires: moment().add(2, 'days').unix() * 1000
          };
          const signedUrls = await storage
            .bucket(process.env.STORAGE_BUCKET)
            .file(name)
            .getSignedUrl(options);
          ejsLocalVariables.zipUrl = signedUrls[0];
        }

        return res.render('index', ejsLocalVariables);
      })
      .catch(error => {
        console.error('Error fetching photos:', error);
        return res.status(500).send({ error });
      });
  });

  app.post('/zip', rateLimiter, async (req, res) => {
    const tags = req.query.tags;
    const tagmode = req.query.tagmode || 'any';

    if (!tags) {
      return res.status(400).send({ error: 'Tags parameter is required' });
    }

    try {
      await pubsubProducer.publishMessage(tags);
      return res.redirect(`/?tags=${encodeURIComponent(tags)}&tagmode=${tagmode}&zipRequested=true`);
    } catch (error) {
      console.error('Error creating zip job:', error);
      return res.status(500).send({ error: 'Failed to create zip job' });
    }
  });

  app.get('/zip/status', rateLimiter, async (req, res) => {
    const tags = req.query.tags;

    if (!tags) {
      return res.status(400).json({ error: 'Tags parameter is required' });
    }

    const isReady = global.completedZips && global.completedZips[tags];

    if (isReady) {
      const name = global.completedZips[tags];
      const options = {
        action: 'read',
        expires: moment().add(2, 'days').unix() * 1000
      };
      const signedUrls = await storage
        .bucket(process.env.STORAGE_BUCKET)
        .file(name)
        .getSignedUrl(options);

      return res.json({
        ready: true,
        url: signedUrls[0]
      });
    }

    return res.json({
      ready: false,
      url: null
    });
  });

  app.get('/healthz', (req, res) => {
    return res.status(200).json({ status: 'ok' });
  });
}

module.exports = route;
