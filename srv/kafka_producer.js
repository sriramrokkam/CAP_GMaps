const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'cap-gps-producer',
    brokers: [(process.env.KAFKA_BROKER || 'localhost:9092')]
});

const admin    = kafka.admin();
const producer = kafka.producer();
let _connected = false;

async function _ensureConnected() {
    if (_connected) return;
    await admin.connect();
    await producer.connect();
    _connected = true;
}

module.exports = {
    async createTopic(topicName) {
        try {
            await _ensureConnected();
            await admin.createTopics({
                topics: [{ topic: topicName, numPartitions: 1, replicationFactor: 1 }],
                waitForLeaders: false
            });
        } catch (err) {
            console.error('kafka_producer.createTopic failed:', err.message);
            throw err;
        }
    },

    async publish(topicName, msg) {
        try {
            await _ensureConnected();
            await producer.send({
                topic: topicName,
                messages: [{ value: JSON.stringify(msg) }]
            });
        } catch (err) {
            console.error('kafka_producer.publish failed:', err.message);
            throw err;
        }
    },

    async deleteTopic(topicName) {
        try {
            await _ensureConnected();
            await admin.deleteTopics({ topics: [topicName] });
        } catch (err) {
            console.error('kafka_producer.deleteTopic failed:', err.message);
            throw err;
        }
    }
};
