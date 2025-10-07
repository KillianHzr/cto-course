const formValidator = require('./form_validator');
const photoModel = require('./photo_model');
const pubsubProducer = require('./pubsub-producer');

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
      zipRequested: zipRequested
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
      .then(photos => {
        ejsLocalVariables.photos = photos;
        ejsLocalVariables.searchResults = true;

        if (global.completedZips && global.completedZips[tags]) {
          ejsLocalVariables.zipUrl = global.completedZips[tags];
        }

        return res.render('index', ejsLocalVariables);
      })
      .catch(error => {
        console.error('Error fetching photos:', error);
        return res.status(500).send({ error });
      });
  });

  app.post('/zip', async (req, res) => {
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

  app.get('/zip/status', (req, res) => {
    const tags = req.query.tags;

    if (!tags) {
      return res.status(400).json({ error: 'Tags parameter is required' });
    }

    const isReady = global.completedZips && global.completedZips[tags];

    return res.json({
      ready: !!isReady,
      url: isReady || null
    });
  });
}

module.exports = route;
