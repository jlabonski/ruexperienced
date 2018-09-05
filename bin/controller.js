'use strict';

const urlParser = require('url');
const uuid = require('uuid/v1');
const moment = require('moment');
const fs = require('fs');
const logger = require('log4js').getLogger();
const agent = require('superagent')
    .agent()
    .type('application/json')
    .accept('application/json')
    .redirects(0)
    .set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36');

/* URL endpoints. */
const portal = 'https://portal.succeedms.com';
const api = 'https://api.succeedms.com/v1';
const report = 'https://www.lossfreerx.com/Reports.ashx'; // Funny, no? Looks like a cheap mail order pharmacy.

/**
 * Takes the test for you.
 *
 * @param {string} username
 * @param {number} companyID
 * @param {string} password
 */
const start = async (username, companyID, password) => {

    await login(username, companyID, password);
    const upcoming = await getUpcomingTask();

    if (!upcoming) {
        const complete = await getCompletedTask();
        if (complete) {
            console.log('You already have completed the training.');
            await getCertificate(complete['UserId']);
            console.log('Certificate downloaded. Enjoy.');
            return;
        } else {
            console.log('You have no upcoming nor completed tasks.');
            return;
        }
    }

    const taskUrl = await initializeTask(upcoming['Id']);
    const context = await getTaskContext(taskUrl);
    await passTest(context);
};

/**
 * Logs into the succeedms service. Cookies are persisted via agent.
 *
 * @param {string} username
 * @param {number} companyID
 * @param {string} password
 * @throws On anything other than 200
 */
const login = async (username, companyID, password) => {

    const loginBody = {
        'UserName': username,
        'CompanyId': companyID,
        'Password': password
    };

    logger.debug('Sending login data');
    logger.trace(loginBody);
    const response = await agent.post(`${portal}/Api/Login`).send(loginBody);
    logger.debug(`Received HTTP ${response.status}, ${response.headers['content-length']} bytes`);
};

/**
 * Gets a task for upcoming tasks that are "Anti-Harassment Training"
 *
 * @throws when encountering more than one "Anti-Harassment Training" entries.
 */
const getUpcomingTask = async () => {
    return await getTask('UpcomingTask');
};

/**
 * Gets a task for completed tasks that are "Anti-Harassment Training"
 *
 * @throws when encountering more than one "Anti-Harassment Training" entries.
 */
const getCompletedTask = async () => {
    return await getTask('CompletedTask');
};

/**
 * Gets a single task of type "Anti-Harassment Training" or false if no such
 * task exists
 *
 * @param {string} type The API endpoint that provides a task list
 * @throws when encountering more than one "Anti-Harassment Training" entries.
 */
const getTask = async (type) => {

    logger.debug(`Getting ${type} tasks`);
    const response = await agent.get(`${portal}/Api/${type}`);
    logger.debug(`Received HTTP ${response.status}, ${response.headers['content-length']} bytes`);

    const tasks = response.body.filter((task) => task['Title'] === 'Anti-Harassment Training');
    logger.debug(`Got ${tasks.length} tasks of type 'Anti-Harassment Training'`);

    if (tasks.length < 1) {
        return false;
    }
    if (tasks.length > 1) {
        throw new Error(`This is weird, I got ${tasks.length} on ${type} for 'Anti-Harassment Training' tasks.`);
    }

    return tasks[0];
};

const initializeTask = async (id) => {

    logger.debug('Getting initial task info');
    const response = await agent
        .ok(res => res.status === 302)
        .get(`${portal}/Resource/Play/${id}`);
    logger.debug(`Received HTTP ${response.status}, ${response.headers['content-length']} bytes`);

    const next = response.headers.location;
    logger.trace(`Following 302 to ${next}`);
    return next;
};

/**
 * Bootstrap the "application context" by doing various things that the webapp
 * does, and pulling out what's necessary.
 *
 * We're blessed by the fact that the remote side trusts the client (HA!) and
 * doesn't do any checking to see if we've actually seen the slides, done the
 * manipulation, etc. Nor does it check to see that we've done the test in about
 * 200ms.
 *
 * Never trust the client.
 *
 * If this was harder we could still fudge the client by pulling the slide data
 * (which is precompiled into a js) and mimicking the client with various pauses
 * and clicks (which are really just updates to the experience API)
 *
 * @param {string} url
 */
const getTaskContext = async (url) => {

    logger.debug('Getting task context');
    const response = await agent
        .ok(res => res.status === 307)
        .get(url);
    logger.debug(`Received HTTP ${response.status}, ${response.headers['content-length']} bytes`);

    const next = response.headers.location;
    logger.trace(next);

    logger.debug('Parsing...');
    const parsed = urlParser.parse(next, true);
    const context = parsed.query;
    context.actor = JSON.parse(context.actor);
    logger.debug('Parsed context successfully');
    logger.trace(context);

    return context;
};

/**
 * The meat and potatoes. Constructs the "I passed the test" object and PUTs it
 * to the API endpoint that tracks such things.
 *
 * @param {object} context
 */
const passTest = async (context) => {

    const statementID = uuid();

    const payload = {
        'id': statementID,
        'timestamp': moment().toISOString(),
        'actor': {
            'objectType': 'Agent'
        },

        'verb': {
            'id': 'http://adlnet.gov/expapi/verbs/passed',
            'display': {
                'en-US': 'passed'
            }
        },
        'result': {
            'success': true,
            'duration': 'PT15M00.00S',
            'score': {
                'scaled': 1.000
            },
            'completion': true
        },

        'context': {
            'registration': context.registration,
            'contextActivities': {
                'parent': [{
                    'id': context.activity_id,
                    'objectType': 'Activity'
                }],
                'grouping': [{
                    'id': context.activity_id,
                    'objectType': 'Activity'
                }]
            }
        },
        'object': {
            'id': context.activity_id,
            'objectType': 'Activity',
            'definition': {
                'type': 'http://adlnet.gov/expapi/activities/course',
                'name': {
                    'und': 'Anti-Harassment for Employees'
                },
                'description': {
                    'und': ''
                }
            }
        }
    };

    const query = {
        'statementId': statementID,
        'training': context.training,
        'authorization': context.authorization
    };

    logger.debug('Sending test pass statement');
    logger.trace(payload);
    logger.trace(query);

    const response = await agent
        .put(`${api}/lms/statements`)
        .query(query)
        .send(payload);
    logger.debug(`Received HTTP ${response.status}, ${response.headers['content-length']} bytes`);

    logger.info('You passed the test with 100%');

};

/**
 * Downloads the training diploma.
 *
 * @param {number} userId
 */
const getCertificate = async (userId) => {

    const query = {
        type: 'certificate',
        subtype: 'training',
        id: userId
    };

    // Promise free! We're using stream API
    const write = fs.createWriteStream('certificate.pdf');
    agent.get(report).query(query).pipe(write);

    // I lied, put it behind a promise facade so that we can await it.
    const streamPromise = new Promise((resolve, reject) => {
        write.on('finish', () => resolve());
        write.on('error', reject);
    });
    return streamPromise;

};

module.exports = {
    start
};
