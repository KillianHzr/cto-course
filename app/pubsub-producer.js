const { PubSub } = require('@google-cloud/pubsub');

const pubsub = new PubSub({
  projectId: process.env.PROJECT_ID
});

async function publishMessage(tags) {
  const topicName = process.env.TOPIC_NAME;
  const topic = pubsub.topic(topicName);

  const messageObject = {
    tags: tags
  };

  const dataBuffer = Buffer.from(JSON.stringify(messageObject));

  try {
    const messageId = await topic.publishMessage({ data: dataBuffer });
    console.log(`Message ${messageId} published.`);
    return messageId;
  } catch (error) {
    console.error(`Error publishing message: ${error.message}`);
    throw error;
  }
}

module.exports = {
  publishMessage
};
